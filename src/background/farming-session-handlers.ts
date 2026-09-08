import { PROGRESS_POLL_MS, STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import type { FarmingSessionContext } from './farming-session-context.ts';
import {
  invalidateFarmingSessionEpoch,
  isFarmingSessionEpochCurrent,
  runFarmingSessionMutation,
  runInFarmingSessionCriticalSection,
} from './farming-session-revision.ts';
import {
  type FarmingSessionStartDependencies,
  runFarmingSessionStart,
} from './farming-session-start-execution.ts';
import {
  applyStopState,
  applyTwitchSessionRetryState,
  clearRecoveryState,
  clearStopState,
} from './recovery-state.ts';
import { clearRotationMetadata } from './runtime-state.ts';
import { stopFarmingSession } from './session-lifecycle.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';
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
  readonly automaticFavoritesEnabled: () => boolean;
  readonly handlePauseFarming: () => Promise<SuccessResult>;
  readonly handleResumeFarming: () => Promise<SuccessResult>;
  readonly handleStartFarming: (
    payload: StartFarmingPayload,
    isCurrent?: () => boolean,
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

  async function stop(options?: FarmingSessionStopOptions): Promise<void> {
    const signInRequired = options?.stopReason === 'sign-in-required';
    if (signInRequired) {
      markTwitchSessionBlocked(state, state.apiConsecutiveFailures);
    }
    await adapters.watchTransport?.stop();
    context.manualWatchTransportSuspended = false;
    await stopFarmingSession(state, {
      ...options,
      onStopMonitoring: dependencies.onStopMonitoring,
      onCloseManagedTab: async (tabId) => {
        await adapters.closeManagedTabIfSafe(tabId);
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
      onSaveTimingState: options?.skipTimingStateSave ? undefined : adapters.saveTimingState,
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
  ): Promise<StartFarmingResult> {
    const isGuardedStart = externalIsCurrent !== undefined;
    const current = externalIsCurrent ?? (() => true);
    const epoch = invalidateFarmingSessionEpoch(state);
    const isCurrent = () => current() && isFarmingSessionEpochCurrent(state, epoch);
    return runInFarmingSessionCriticalSection(state, () =>
      runFarmingSessionStart(context, dependencies, payload, isCurrent, isGuardedStart),
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
    return runFarmingSessionMutation(state, stopManually);
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
    if (state.appState.isRunning) return;
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
    await dependencies.onEnsureWorkspace();
    if (!state.appState.tabId) {
      await dependencies.onAcquireStreamer();
    }
    dependencies.onStartMonitoring();
    await adapters.saveState(state);
    await adapters.saveTimingState(state);
  }

  async function pause(): Promise<SuccessResult> {
    await adapters.trackActivity('pause-farming');
    state.appState.isPaused = true;
    state.playbackAttentionWarningSent = false;
    await adapters.watchTransport?.stop();
    context.manualWatchTransportSuspended = false;
    dependencies.onStopMonitoring();
    await adapters.saveState(state);
    await adapters.saveTimingState(state);
    return { success: true };
  }

  function handlePauseFarming(): Promise<SuccessResult> {
    return runFarmingSessionMutation(state, pause);
  }

  async function resume(): Promise<SuccessResult> {
    await adapters.trackActivity('resume-farming');
    state.appState.isPaused = false;
    state.invalidStreamChecks = 0;
    state.noProgressRotationAttempts = 0;
    clearStopState(state);
    if (state.appState.tabId) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    }
    clearRecoveryState(state);
    if (state.appState.activeStreamer && state.appState.selectedGame) {
      await adapters.watchTransport?.start(state.appState.activeStreamer);
    }
    context.manualWatchTransportSuspended = false;
    dependencies.onStartMonitoring();
    await adapters.saveState(state);
    await adapters.saveTimingState(state);
    return { success: true };
  }

  function handleResumeFarming(): Promise<SuccessResult> {
    return runFarmingSessionMutation(state, resume);
  }

  return {
    automaticFavoritesEnabled: () => state.appState.autoStartFavoriteGames,
    handlePauseFarming,
    handleResumeFarming,
    handleStartFarming,
    handleStopFarming,
    recoverTwitchSession,
    resumeAfterAuthRecovery,
    stop,
  };
}
