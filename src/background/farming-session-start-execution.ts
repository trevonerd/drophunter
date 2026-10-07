import { gameKey } from '../shared/game-selection.ts';
import { splitDropsForSelectedGame } from './drops-projection.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { reconcileFarmingSessionTargets } from './farming-session-targets.ts';
import { logWarn } from './logging.ts';
import { queueCleanupNotification } from './queue-availability-cleanup-activity.ts';
import { markQueueEntryManual } from './queue-operations.ts';
import { applyStopState, clearRecoveryState, clearStopState } from './recovery-state.ts';
import { handleStartFarming as startFarming } from './session-lifecycle.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';
import { clearCampaignStallBlock } from './stalled-campaign-block.ts';
import { suspendWatchObservation } from './streamer-watch-attempt.ts';

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
      next.appState.stalledCampaignBlocksByKey = clearCampaignStallBlock(
        next.appState.stalledCampaignBlocksByKey,
        game,
      );
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
