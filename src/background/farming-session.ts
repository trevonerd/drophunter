import { dropMatchesSelectedGame } from './drops-projection.ts';
import type { RefreshDropsOutcome } from './drops-tick-refresh.ts';
import { createFarmingCampaignTransition } from './farming-campaign-transition.ts';
import { createFarmingQueueProgression } from './farming-queue-progression.ts';
import type { FarmingSessionAdapters, RefreshDropsOptions } from './farming-session-context.ts';
import { createFarmingSessionContext } from './farming-session-context.ts';
import { createFarmingSessionHandlers, type FarmingSessionStopOptions } from './farming-session-handlers.ts';
import { createFarmingSessionMonitoring } from './farming-session-monitoring.ts';
import { createFarmingSessionQueue } from './farming-session-queue.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { createFarmingSessionStreaming } from './farming-session-streaming.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type {
  FarmingSessionAdapters,
  RefreshDropsOptions,
  StreamContext,
} from './farming-session-context.ts';

export function createFarmingSession(state: ServiceWorkerState, adapters: FarmingSessionAdapters) {
  const context = createFarmingSessionContext(state, adapters);
  if (adapters.watchTransport?.prepare) {
    context.transitionCampaign = createFarmingCampaignTransition(context, (working, isCurrent) =>
      createFarmingSession(working, {
        ...adapters,
        saveState: async () => {},
        saveTimingState: async () => {},
      }).refreshDropsData({
        includeCampaignFetch:
          !working.hasCurrentGenerationCampaignValidation ||
          !working.cachedDropsSnapshot.some(
            (drop) =>
              working.appState.selectedGame !== null &&
              dropMatchesSelectedGame(drop, working.appState.selectedGame),
          ),
        includeInventoryFetch: false,
        sessionRecoveryMode: 'passive',
        suppressNotifications: true,
        claimRecordingTarget: state,
        isCurrent,
      }),
    );
  }
  const progression = createFarmingQueueProgression(context, {
    onStopFarmingSession: stop,
    onStopMonitoring: () => stopMonitoring(),
  });
  const streaming = createFarmingSessionStreaming(context, {
    onRefreshDropsData: refreshDropsData,
    queueProgression: progression,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
    onWakeMonitoring: (isCurrent) => {
      if (!isCurrent()) return;
      if (state.monitorTickInFlight) state.cancelledAcquisitionMonitoringWake = isCurrent;
      else startMonitoring(true);
    },
  });
  const {
    acquireStreamerForSelectedGame,
    ensureWorkspaceForSelectedGame,
    handleAuthoritativeCampaignUnavailable,
    recoverStalledProgress,
    rotateStreamerIfInvalid,
    rotateStreamerForTransportFailure,
  } = streaming;
  const monitoring = createFarmingSessionMonitoring(context, {
    onRotateStreamerIfInvalid: rotateStreamerIfInvalid,
    onRotateStreamerForTransportFailure: rotateStreamerForTransportFailure,
    onAcquireStreamerForSelectedGame: acquireStreamerForSelectedGame,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
    onRecoverStalledProgress: recoverStalledProgress,
  });
  const { startMonitoring, stopMonitoring } = monitoring;
  const queue = createFarmingSessionQueue(context, {
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onRefreshDropsData: refreshDropsData,
    onAcquireStreamer: acquireStreamerForSelectedGame,
  });
  const handlers = createFarmingSessionHandlers(context, {
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onRefreshDropsData: refreshDropsData,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
    onAcquireStreamer: acquireStreamerForSelectedGame,
    onStartMonitoring: startMonitoring,
    onStopMonitoring: stopMonitoring,
  });

  function refreshDropsData(options: RefreshDropsOptions = {}): Promise<RefreshDropsOutcome> {
    return monitoring.refreshDropsData(options);
  }

  function checkDropProgress(): Promise<void> {
    return monitoring.checkDropProgress().finally(() => {
      if (state.monitorTickInFlight) return;
      const wake = state.cancelledAcquisitionMonitoringWake;
      state.cancelledAcquisitionMonitoringWake = null;
      if (wake?.()) startMonitoring(true);
    });
  }

  async function handleClearQueue() {
    if (state.appState.isRunning || state.appState.isPaused || state.appState.manualQueueAuthorized) {
      const epoch = currentFarmingSessionEpoch(state) + 1;
      await handlers.handleStopFarming();
      if (currentFarmingSessionEpoch(state) !== epoch)
        return { success: true as const, queueLength: state.appState.queue.length };
    }
    return queue.handleClearQueue();
  }

  function stop(options?: FarmingSessionStopOptions): Promise<void> {
    return handlers.stop(options);
  }

  function advanceQueueIfCompleted(isCurrent?: () => boolean): Promise<boolean> {
    return progression.advanceIfCompleted(isCurrent);
  }

  return {
    ...handlers,
    ...queue,
    acquireStreamerForSelectedGame,
    advanceQueueIfCompleted,
    checkDropProgress,
    handleAuthoritativeCampaignUnavailable,
    handleClearQueue,
    refreshDropsData,
    reconcileQueueAvailability: progression.reconcileAvailability,
    startMonitoring,
    stop,
    stopMonitoring,
  };
}
