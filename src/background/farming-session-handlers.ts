import { PROGRESS_POLL_MS, STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import type { FarmingSessionContext } from './farming-session-context.ts';
import {
  currentFarmingSessionEpoch,
  interruptFarmingSessionMutation,
  invalidateFarmingSessionEpoch,
  isFarmingSessionEpochCurrent,
  runFarmingSessionMutation,
  runInFarmingSessionCriticalSection,
} from './farming-session-revision.ts';
import {
  type FarmingSessionStartDependencies,
  runFarmingSessionStart,
} from './farming-session-start-execution.ts';
import { logWarn } from './logging.ts';
import {
  applyDirectoryUnavailableRecoveryState,
  applyNoStreamersRecoveryState,
  applyPlaybackStartRecoveryState,
  applyStopState,
  applyTwitchSessionRetryState,
  clearRecoveryState,
  clearStopState,
} from './recovery-state.ts';
import { clearRotationMetadata } from './runtime-state.ts';
import { stopFarmingSession } from './session-lifecycle.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';
import { NO_STREAMERS_RETRY_MS } from './stream-rotation.ts';
import { markTwitchSessionBlocked, markTwitchSessionReady } from './twitch-session-sync.ts';

export type FarmingSessionStopOptions = {
  readonly skipTimingStateSave?: boolean;
  readonly suppressNotifications?: boolean;
  readonly notification?: { readonly title: string; readonly message: string };
  readonly stopReason?: string;
  readonly stopMessage?: string | null;
};

export type FarmingSessionAuthRecoveryOptions = {
  readonly notification?: { readonly title: string; readonly message: string };
};

type FarmingSessionHandlerDependencies = FarmingSessionStartDependencies;

type SuccessResult = { readonly success: true };

export type FarmingSessionHandlers = {
  readonly handlePauseFarming: () => Promise<SuccessResult>;
  readonly handleResumeFarming: () => Promise<SuccessResult>;
  readonly handleStartFarming: (
    payload: StartFarmingPayload,
    isCurrent?: () => boolean,
    preserveQueueContext?: boolean,
  ) => Promise<StartFarmingResult>;
  readonly handleStopFarming: () => Promise<SuccessResult>;
  readonly recoverTwitchSession: (options?: FarmingSessionAuthRecoveryOptions) => Promise<void>;
  readonly resumeAfterAuthRecovery: () => Promise<void>;
  readonly stop: (options?: FarmingSessionStopOptions) => Promise<void>;
};

export function createFarmingSessionHandlers(
  context: FarmingSessionContext,
  dependencies: FarmingSessionHandlerDependencies,
): FarmingSessionHandlers {
  const { state, adapters } = context;

  function scheduleTimingStateSave(): void {
    void adapters.saveTimingState(state).catch((error: unknown) => {
      logWarn('Farming session timing persistence failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
  }

  async function stop(options?: FarmingSessionStopOptions): Promise<void> {
    const signInRequired = options?.stopReason === 'sign-in-required';
    if (signInRequired) {
      markTwitchSessionBlocked(state, state.apiConsecutiveFailures);
    }
    void adapters.watchTransport?.stop().catch((error: unknown) => {
      logWarn('Stopped session transport cleanup failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
    context.manualWatchTransportSuspended = false;
    await stopFarmingSession(state, {
      ...options,
      onStopMonitoring: dependencies.onStopMonitoring,
      onCloseManagedTab: async (tabId) => {
        void adapters.closeManagedTabIfSafe(tabId).catch((error: unknown) => {
          logWarn('Stopped session tab cleanup failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        });
      },
      onClearRotationMetadata: clearRotationMetadata,
      onApplyStopState: applyStopState,
      onNotify:
        options?.suppressNotifications || (signInRequired && adapters.automationNotify)
          ? undefined
          : async (title, message) => {
              await adapters.notify(title, message);
            },
      onSystemAlert:
        options?.suppressNotifications || (signInRequired && adapters.automationNotify)
          ? undefined
          : adapters.telegramSystemAlert,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: options?.skipTimingStateSave ? undefined : async () => scheduleTimingStateSave(),
    });
    if (signInRequired && adapters.automationNotify) {
      const selectedGame = state.appState.selectedGame;
      await adapters.automationNotify({
        transitionId: `sign-in-required:${selectedGame?.campaignId ?? 'session'}:${state.appState.twitchSessionSyncState.attempts}`,
        event: 'sign-in-required',
        campaignId: selectedGame?.campaignId ?? 'session',
        title: options?.notification?.title ?? 'Sign-in required',
        message:
          options?.stopMessage ??
          options?.notification?.message ??
          'DropHunter could not refresh your Twitch session. Please open Twitch and sign in.',
        telegramReason: 'sign-in-required',
      });
    }
  }

  function handleStartFarming(
    payload: StartFarmingPayload,
    externalIsCurrent?: () => boolean,
    preserveQueueContext = false,
  ): Promise<StartFarmingResult> {
    const isGuardedStart = externalIsCurrent !== undefined;
    const current = externalIsCurrent ?? (() => true);
    const epoch = invalidateFarmingSessionEpoch(state);
    const isCurrent = () => current() && isFarmingSessionEpochCurrent(state, epoch);
    return runInFarmingSessionCriticalSection(state, () =>
      runFarmingSessionStart(context, dependencies, payload, isCurrent, isGuardedStart, preserveQueueContext),
    );
  }

  async function stopManually(): Promise<SuccessResult> {
    await adapters.trackActivity('stop-farming');
    await stop({ stopReason: 'user-stop', stopMessage: 'Stopped by user.' });
    state.appState.manualQueueAuthorized = false;
    state.appState.farmingSessionOrigin = null;
    await adapters.saveState(state);
    return { success: true };
  }

  function handleStopFarming(): Promise<SuccessResult> {
    state.appState.isRunning = false;
    state.appState.isPaused = false;
    state.appState.wasRunning = false;
    state.appState.manualQueueAuthorized = false;
    state.tickGeneration += 1;
    state.monitorTickInFlight = false;
    state.monitorTickDeadlineAt = 0;
    state.streamerAcquisitionGeneration += 1;
    state.streamerAcquisitionInFlight = null;
    state.streamerAcquisitionDeadlineAt = 0;
    dependencies.onStopMonitoring();
    return interruptFarmingSessionMutation(state, stopManually);
  }

  async function recoverTwitchSession(_options?: FarmingSessionAuthRecoveryOptions): Promise<void> {
    if (!state.appState.isRunning) return;

    state.apiConsecutiveFailures += 1;
    const retryDelayMs = Math.min(
      2 ** Math.max(0, state.apiConsecutiveFailures - 1) * PROGRESS_POLL_MS,
      10 * 60_000,
    );
    state.apiBackoffUntil = Date.now() + retryDelayMs;
    applyTwitchSessionRetryState(state, state.apiBackoffUntil, state.apiConsecutiveFailures);

    await adapters.saveState(state);
    await adapters.saveTimingState(state);
  }

  async function resumeAfterAuthRecovery(): Promise<void> {
    if (
      state.appState.isRunning ||
      state.appState.isPaused ||
      (state.appState.lastStopReason && state.appState.lastStopReason !== 'sign-in-required')
    )
      return;
    const epoch = currentFarmingSessionEpoch(state);
    const selectedGame = state.appState.selectedGame ?? state.appState.queue[0] ?? null;
    if (!selectedGame) return;

    state.appState.selectedGame = selectedGame;
    state.appState.isRunning = true;
    state.appState.isPaused = false;
    state.appState.completionNotified = false;
    clearStopState(state);
    clearRecoveryState(state);
    markTwitchSessionReady(state);
    resetStreamTrackingState(state);
    state.tickGeneration += 1;
    const generation = state.tickGeneration;
    const isCurrent = () =>
      currentFarmingSessionEpoch(state) === epoch &&
      state.tickGeneration === generation &&
      state.appState.isRunning &&
      !state.appState.isPaused;
    await dependencies.onEnsureWorkspace(isCurrent);
    if (!isCurrent()) return;
    if (!state.appState.tabId) {
      await dependencies.onAcquireStreamer(isCurrent);
      if (!isCurrent()) return;
    }
    dependencies.onStartMonitoring();
    await adapters.saveState(state);
    if (!isCurrent()) return;
    await adapters.saveTimingState(state);
  }

  async function pause(trackActivity: boolean): Promise<SuccessResult> {
    if (trackActivity) await adapters.trackActivity('pause-farming');
    state.appState.isPaused = true;
    state.playbackAttentionWarningSent = false;
    await adapters.watchTransport?.stop();
    context.manualWatchTransportSuspended = false;
    dependencies.onStopMonitoring();
    await adapters.saveState(state);
    scheduleTimingStateSave();
    return { success: true };
  }

  function handlePauseFarming(): Promise<SuccessResult> {
    return runFarmingSessionMutation(state, () => pause(true));
  }

  async function resume(epoch: number): Promise<SuccessResult> {
    const ownsResume = () => isFarmingSessionEpochCurrent(state, epoch) && state.appState.isRunning;
    if (!ownsResume()) return { success: true };
    await adapters.trackActivity('resume-farming');
    if (!ownsResume()) return { success: true };
    state.appState.isPaused = false;
    const isCurrent = () => ownsResume() && !state.appState.isPaused;
    state.invalidStreamChecks = 0;
    state.noProgressRotationAttempts = 0;
    clearStopState(state);
    if (state.appState.tabId) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    }
    let failure: 'no-streamers' | 'directory-unavailable' | 'open-failed' | null = null;
    if (context.transitionCampaign && state.appState.selectedGame) {
      const result = await context.transitionCampaign(state.appState.selectedGame, isCurrent);
      if (!isCurrent() || result.kind === 'cancelled') return { success: true };
      if (result.kind === 'failed') failure = result.reason;
    } else if (state.appState.activeStreamer && state.appState.selectedGame) {
      try {
        const result = await adapters.watchTransport?.start(state.appState.activeStreamer, isCurrent);
        if (!isCurrent() || result?.kind === 'cancelled') return { success: true };
        if (result?.kind === 'failed') failure = 'open-failed';
      } catch {
        if (!isCurrent()) return { success: true };
        failure = 'open-failed';
      }
    }
    if (!isCurrent()) return { success: true };
    if (failure) {
      const existingDeadline = Math.max(state.recoveryBackoffUntil, state.appState.recoveryBackoffUntil ?? 0);
      const retryAt =
        existingDeadline > context.now() ? existingDeadline : context.now() + NO_STREAMERS_RETRY_MS;
      const attempts = state.appState.recoveryAttempts ?? 0;
      if (failure === 'no-streamers') applyNoStreamersRecoveryState(state, retryAt, attempts);
      else if (failure === 'directory-unavailable')
        applyDirectoryUnavailableRecoveryState(state, retryAt, attempts);
      else applyPlaybackStartRecoveryState(state, retryAt, attempts);
    } else clearRecoveryState(state);
    context.manualWatchTransportSuspended = false;
    dependencies.onStartMonitoring();
    await adapters.saveState(state);
    if (!isCurrent()) return { success: true };
    scheduleTimingStateSave();
    return { success: true };
  }

  function handleResumeFarming(): Promise<SuccessResult> {
    const epoch = invalidateFarmingSessionEpoch(state);
    return runInFarmingSessionCriticalSection(state, () => resume(epoch));
  }

  return {
    handlePauseFarming,
    handleResumeFarming,
    handleStartFarming,
    handleStopFarming,
    recoverTwitchSession,
    resumeAfterAuthRecovery,
    stop,
  };
}
