import { gameKey } from '../shared/game-selection.ts';
import { PROGRESS_POLL_MS, STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import { splitDropsForSelectedGame } from './drops-projection.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import {
  currentFarmingSessionEpoch,
  interruptFarmingSessionMutation,
  invalidateFarmingSessionEpoch,
  isFarmingSessionEpochCurrent,
  runInFarmingSessionCriticalSection,
} from './farming-session-revision.ts';
import { reconcileFarmingSessionTargets } from './farming-session-targets.ts';
import { logWarn } from './logging.ts';
import { queueCleanupNotification } from './queue-availability-cleanup-activity.ts';
import { markQueueEntryManual } from './queue-operations.ts';
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
import { handleStartFarming as startFarming, stopFarmingSession } from './session-lifecycle.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';
import { NO_STREAMERS_RETRY_MS } from './stream-rotation.ts';
import { resumeWatchObservation, suspendWatchObservation } from './streamer-watch-attempt.ts';
import { markTwitchSessionReady } from './twitch-session-sync.ts';

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
  readonly handleStartQueuedCampaign: (campaignKey: string) => Promise<StartFarmingResult>;
  readonly handlePauseFarming: () => Promise<SuccessResult>;
  readonly handleResumeFarming: () => Promise<SuccessResult>;
  readonly handleStartFarming: (
    payload: StartFarmingPayload,
    isCurrent?: () => boolean,
    preserveQueueContext?: boolean,
    forceCampaign?: boolean,
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
  let queuedStart: { readonly key: string; readonly promise: Promise<StartFarmingResult> } | null = null;

  function scheduleTimingStateSave(): void {
    void adapters.saveTimingState(state).catch((error: unknown) => {
      logWarn('Farming session timing persistence failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
  }

  async function stop(options?: FarmingSessionStopOptions): Promise<void> {
    const epoch = currentFarmingSessionEpoch(state);
    const isCurrent = () => isFarmingSessionEpochCurrent(state, epoch);
    const signInRequired = options?.stopReason === 'sign-in-required';
    if (signInRequired) {
      await recoverTwitchSession();
      return;
    }
    await adapters.watchTransport?.stop().catch((error: unknown) => {
      logWarn('Stopped session transport cleanup failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
    if (!isCurrent()) return;
    context.manualWatchTransportSuspended = false;
    await stopFarmingSession(state, {
      ...options,
      isCurrent,
      onStopMonitoring: dependencies.onStopMonitoring,
      onClearRotationMetadata: clearRotationMetadata,
      onApplyStopState: applyStopState,
      onNotify: options?.suppressNotifications
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
  }

  function handleStartFarming(
    payload: StartFarmingPayload,
    externalIsCurrent?: () => boolean,
    preserveQueueContext = false,
    forceCampaign = false,
  ): Promise<StartFarmingResult> {
    const current = externalIsCurrent ?? (() => true);
    const epoch = context.transitionCampaign
      ? currentFarmingSessionEpoch(state) + 1
      : invalidateFarmingSessionEpoch(state);
    const isCurrent = () => current() && isFarmingSessionEpochCurrent(state, epoch);
    state.tickGeneration += 1;
    state.monitorTickInFlight = false;
    state.monitorTickDeadlineAt = 0;
    state.streamerAcquisitionGeneration += 1;
    state.streamerAcquisitionInFlight = null;
    state.streamerAcquisitionDeadlineAt = 0;
    const run = context.transitionCampaign
      ? interruptFarmingSessionMutation
      : runInFarmingSessionCriticalSection;
    return run(state, () =>
      runFarmingSessionStart(context, dependencies, payload, isCurrent, preserveQueueContext, forceCampaign),
    );
  }

  function handleStartQueuedCampaign(campaignKey: string): Promise<StartFarmingResult> {
    if (queuedStart?.key === campaignKey) return queuedStart.promise;
    const game = state.appState.queue.find((entry) => gameKey(entry) === campaignKey);
    if (!game) return Promise.resolve({ success: false, error: 'Campaign is no longer in the queue.' });
    const promise = handleStartFarming({ game }, undefined, false, true).finally(() => {
      if (queuedStart?.promise === promise) queuedStart = null;
    });
    queuedStart = { key: campaignKey, promise };
    return promise;
  }

  async function stopManually(): Promise<SuccessResult> {
    const epoch = currentFarmingSessionEpoch(state);
    await adapters.trackActivity('stop-farming');
    if (!isFarmingSessionEpochCurrent(state, epoch)) return { success: true };
    await stop({ stopReason: 'user-stop', stopMessage: 'Stopped by user.' });
    if (!isFarmingSessionEpochCurrent(state, epoch)) return { success: true };
    state.appState.manualQueueAuthorized = false;
    state.appState.farmingSessionOrigin = null;
    state.appState.farmingSessionTargets = {};
    state.appState.campaignFailureEpisodesByKey = {};
    await adapters.saveState(state);
    return { success: true };
  }

  function handleStopFarming(): Promise<SuccessResult> {
    queuedStart = null;
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
    if (!state.appState.isRunning || state.appState.isPaused || state.appState.lastStopReason === 'user-stop')
      return;
    if (
      state.appState.twitchSessionSyncState.status === 'retrying' &&
      !state.appState.activeStreamer &&
      (state.appState.twitchSessionSyncState.nextRetryAt ?? 0) > context.now()
    )
      return;
    const epoch = currentFarmingSessionEpoch(state);
    await adapters.watchTransport?.stop();
    if (
      epoch !== currentFarmingSessionEpoch(state) ||
      !state.appState.isRunning ||
      state.appState.isPaused ||
      state.appState.lastStopReason === 'user-stop'
    )
      return;
    state.appState.activeStreamer = null;

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
      state.appState.isPaused ||
      (!state.appState.manualQueueAuthorized && state.appState.farmingSessionOrigin !== 'automatic') ||
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
    if (!state.appState.activeStreamer) {
      await dependencies.onAcquireStreamer(isCurrent);
      if (!isCurrent()) return;
    }
    dependencies.onStartMonitoring();
    await adapters.saveState(state);
    if (!isCurrent()) return;
    await adapters.saveTimingState(state);
  }

  async function pause(trackActivity: boolean): Promise<SuccessResult> {
    const epoch = currentFarmingSessionEpoch(state);
    if (trackActivity) await adapters.trackActivity('pause-farming');
    if (!isFarmingSessionEpochCurrent(state, epoch)) return { success: true };
    state.appState.isPaused = true;
    const game = state.appState.pendingWatchTarget?.game ?? state.appState.selectedGame;
    const metadata = game ? state.appState.queueEntryMetadataByKey[gameKey(game)] : undefined;
    if (game && metadata?.watchAttempt)
      state.appState.queueEntryMetadataByKey[gameKey(game)] = {
        ...metadata,
        watchAttempt: { ...metadata.watchAttempt, suspendedAt: context.now() },
      };
    await adapters.watchTransport?.stop();
    if (!isFarmingSessionEpochCurrent(state, epoch)) return { success: true };
    context.manualWatchTransportSuspended = false;
    dependencies.onStopMonitoring();
    await adapters.saveState(state);
    scheduleTimingStateSave();
    return { success: true };
  }

  function handlePauseFarming(): Promise<SuccessResult> {
    queuedStart = null;
    state.appState.isPaused = true;
    state.tickGeneration += 1;
    state.monitorTickInFlight = false;
    state.monitorTickDeadlineAt = 0;
    state.streamerAcquisitionGeneration += 1;
    state.streamerAcquisitionInFlight = null;
    state.streamerAcquisitionDeadlineAt = 0;
    dependencies.onStopMonitoring();
    return interruptFarmingSessionMutation(state, () => pause(true));
  }

  async function resume(epoch: number): Promise<SuccessResult> {
    const ownsResume = () => isFarmingSessionEpochCurrent(state, epoch) && state.appState.isRunning;
    if (!ownsResume()) return { success: true };
    await adapters.trackActivity('resume-farming');
    if (!ownsResume()) return { success: true };
    state.appState.isPaused = false;
    resumeWatchObservation(state, context.now());
    const isCurrent = () => ownsResume() && !state.appState.isPaused;
    state.invalidStreamChecks = 0;
    state.noProgressRotationAttempts = 0;
    clearStopState(state);
    if (state.appState.tabId) {
      state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    }
    let failure: 'no-streamers' | 'directory-unavailable' | 'open-failed' | null = null;
    if (context.transitionCampaign && state.appState.selectedGame && !state.appState.activeStreamer) {
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
    handleStartQueuedCampaign,
    handlePauseFarming,
    handleResumeFarming,
    handleStartFarming,
    handleStopFarming,
    recoverTwitchSession,
    resumeAfterAuthRecovery,
    stop,
  };
}

export type FarmingSessionStartDependencies = {
  readonly onEnsureWorkspace: (isCurrent?: () => boolean) => Promise<void>;
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<unknown>;
  readonly onAdvanceQueueIfCompleted: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onAcquireStreamer: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onStartMonitoring: (immediate?: boolean) => void;
  readonly onStopMonitoring: () => void;
};

function superseded(): StartFarmingResult {
  return { success: false, error: 'Farming start was superseded.' };
}

export async function runFarmingSessionStart(
  context: FarmingSessionContext,
  dependencies: FarmingSessionStartDependencies,
  payload: StartFarmingPayload,
  isCurrent: () => boolean,
  preserveQueueContext = false,
  forceCampaign = false,
): Promise<StartFarmingResult> {
  const { state, adapters } = context;
  const finishStart = async (persist: boolean): Promise<StartFarmingResult> => {
    if (!isCurrent()) return superseded();
    if (state.appState.monitorAutoOpen) {
      await new Promise((resolve) => setTimeout(resolve, adapters.monitorAutoOpenDelayMs));
      if (!isCurrent()) return superseded();
      await adapters.openMonitorDashboardWindow({ toggle: false }).catch(() => undefined);
      if (!isCurrent()) return superseded();
    }
    if (persist) {
      await adapters.saveState(state);
      if (!isCurrent()) return superseded();
      await adapters.saveTimingState(state);
      if (!isCurrent()) return superseded();
    }
    dependencies.onStartMonitoring();
    return { success: true };
  };
  if (context.transitionCampaign) {
    if (!payload.game) return { success: false, error: 'No game selected.' };
    if (!isCurrent() || state.backupImportInProgress) return superseded();
    await adapters.trackActivity('start-farming');
    if (!isCurrent()) return superseded();
    const game = payload.game;
    const key = gameKey(game);
    const next = { ...state, appState: structuredClone(state.appState) };
    if (next.appState.selectedGame && gameKey(next.appState.selectedGame) !== key)
      suspendWatchObservation(next);
    Object.assign(next.appState, {
      selectedGame: game,
      isRunning: true,
      isPaused: false,
      activeStreamer: null,
      tabId: null,
      watchHealth: null,
      completionNotified: false,
    });
    if (!preserveQueueContext) {
      next.appState.queue = [game, ...next.appState.queue.filter((entry) => gameKey(entry) !== key)];
      next.appState.manualQueueAuthorized = true;
      next.appState.farmingSessionOrigin = 'manual';
      next.appState.forcedCampaignKey = forceCampaign ? key : null;
      next.appState.queueResumeOnAvailability = false;
      next.appState.queueAcquisitionRound = null;
      markQueueEntryManual(next, game);
      reconcileFarmingSessionTargets(next);
      clearRecoveryState(next);
    }
    clearStopState(next);
    resetStreamTrackingState(next, preserveQueueContext);
    next.avoidStreamerName = null;
    splitDropsForSelectedGame(next, next.cachedDropsSnapshot);
    try {
      await adapters.saveState(next, { deferPublicEffects: true, transactionOwner: state });
      if (!isCurrent()) {
        await adapters.saveState(state);
        return superseded();
      }
    } catch {
      return { success: false, error: 'Unable to save the farming start.' };
    }
    state.appState = next.appState;
    resetStreamTrackingState(state, preserveQueueContext);
    adapters.broadcastStateUpdate(state.appState);
    void adapters.saveTimingState(state).catch((error: unknown) => {
      logWarn('Farming session timing persistence failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
    if (!isCurrent()) return superseded();
    dependencies.onStartMonitoring(true);
    if (state.appState.monitorAutoOpen) {
      void adapters.openMonitorDashboardWindow({ toggle: false }).catch(() => undefined);
    }
    return { success: true };
  }
  const result = await startFarming(state, payload, {
    isCurrent,
    preserveQueueContext,
    forceCampaign,
    onEnsureWorkspace: dependencies.onEnsureWorkspace,
    onRefreshDropsData: async (options) => {
      await dependencies.onRefreshDropsData(options);
    },
    onSaveState: () => adapters.saveState(state),
    onSaveTimingState: adapters.saveTimingState,
    onBroadcastStateUpdate: () => adapters.broadcastStateUpdate(state.appState),
    onStopMonitoring: dependencies.onStopMonitoring,
    onTrackActivity: adapters.trackActivity,
    onApplyStopState: applyStopState,
    onQueueCampaignsRemoved: async (queueCleanup) => {
      const notification = queueCleanupNotification(queueCleanup);
      await adapters.automationNotify?.({
        transitionId: notification.transitionId,
        event: 'queue-cleanup',
        campaignId: 'queue',
        telegramReason: 'queue-cleanup',
        title: 'Queue updated',
        message: notification.message,
      });
    },
  });
  if (!result.success || !isCurrent()) return result.success ? superseded() : result;

  if (!isCurrent()) return superseded();
  if (!state.appState.activeStreamer && !state.appState.tabId && state.appState.selectedGame) {
    await dependencies.onAcquireStreamer(isCurrent);
    if (!isCurrent()) return superseded();
  }
  return finishStart(true);
}
