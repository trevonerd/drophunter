import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { queueCleanupNotification } from './queue-availability-cleanup-activity.ts';
import { applyStopState } from './recovery-state.ts';
import { handleStartFarming as startFarming } from './session-lifecycle.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';

export type FarmingSessionStartDependencies = {
  readonly onEnsureWorkspace: (isCurrent?: () => boolean) => Promise<void>;
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<unknown>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onAcquireStreamer: (isCurrent?: () => boolean) => Promise<boolean>;
  readonly onStartMonitoring: () => void;
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
  skipLegacyQueueAdvance: boolean,
): Promise<StartFarmingResult> {
  const { state, adapters } = context;
  const result = await startFarming(state, payload, {
    ...(skipLegacyQueueAdvance ? { isCurrent } : {}),
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

  // A guarded auto-resume has already refreshed and revalidated its selected
  // campaign above. Avoid the regular queue advancement path because its
  // legacy callbacks do not receive the activation predicate. Manual starts
  // retain their established queue-advance behavior.
  if (!skipLegacyQueueAdvance) {
    const advanced = await dependencies.onAdvanceQueueIfCompleted();
    if (!isCurrent()) return superseded();
    if (!advanced) return { success: false, error: 'Unable to advance completed queue.' };
  }
  if (!isCurrent()) return superseded();
  if (!state.appState.activeStreamer && !state.appState.tabId && state.appState.selectedGame) {
    await dependencies.onAcquireStreamer(isCurrent);
    if (!isCurrent()) return superseded();
  }
  if (state.appState.monitorAutoOpen) {
    await new Promise((resolve) => setTimeout(resolve, adapters.monitorAutoOpenDelayMs));
    if (!isCurrent()) return superseded();
    await adapters.openMonitorDashboardWindow({ toggle: false }).catch(() => undefined);
    if (!isCurrent()) return superseded();
  }

  if (!isCurrent()) return superseded();
  await adapters.saveState(state);
  if (!isCurrent()) return superseded();
  await adapters.saveTimingState(state);
  if (!isCurrent()) return superseded();
  dependencies.onStartMonitoring();
  return { success: true };
}
