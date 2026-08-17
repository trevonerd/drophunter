import { STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { runFarmingSessionMutation } from './farming-session-revision.ts';
import { applyStopState, clearRecoveryState, clearStopState } from './recovery-state.ts';
import { clearRotationMetadata } from './runtime-state.ts';
import { handleStartFarming as startFarming, stopFarmingSession } from './session-lifecycle.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';

export type FarmingSessionStopOptions = {
  readonly notification?: { readonly title: string; readonly message: string };
  readonly stopReason?: string;
  readonly stopMessage?: string | null;
};

type FarmingSessionHandlerDependencies = {
  readonly onEnsureWorkspace: () => Promise<void>;
  readonly onRefreshDropsData: (options?: RefreshDropsOptions) => Promise<void>;
  readonly onAdvanceQueueIfCompleted: () => Promise<boolean>;
  readonly onAcquireStreamer: () => Promise<boolean>;
  readonly onStartMonitoring: () => void;
  readonly onStopMonitoring: () => void;
};

type SuccessResult = { readonly success: true };

export type FarmingSessionHandlers = {
  readonly handlePauseFarming: () => Promise<SuccessResult>;
  readonly handleRefreshDrops: () => Promise<SuccessResult>;
  readonly handleResumeFarming: () => Promise<SuccessResult>;
  readonly handleStartFarming: (payload: StartFarmingPayload) => Promise<StartFarmingResult>;
  readonly handleStopFarming: () => Promise<SuccessResult>;
  readonly stop: (options?: FarmingSessionStopOptions) => Promise<void>;
};

export function createFarmingSessionHandlers(
  context: FarmingSessionContext,
  dependencies: FarmingSessionHandlerDependencies,
): FarmingSessionHandlers {
  const { state, adapters } = context;

  async function stop(options?: FarmingSessionStopOptions): Promise<void> {
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
      onNotify: async (title, message) => {
        await adapters.notify(title, message);
      },
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
    });
  }

  async function start(payload: StartFarmingPayload): Promise<StartFarmingResult> {
    const result = await startFarming(state, payload, {
      onEnsureWorkspace: dependencies.onEnsureWorkspace,
      onRefreshDropsData: dependencies.onRefreshDropsData,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: adapters.saveTimingState,
      onBroadcastStateUpdate: () => adapters.broadcastStateUpdate(state.appState),
      onStopMonitoring: dependencies.onStopMonitoring,
      onTrackActivity: adapters.trackActivity,
      onApplyStopState: applyStopState,
    });
    if (!result.success) {
      return result;
    }

    const advanced = await dependencies.onAdvanceQueueIfCompleted();
    if (!advanced) {
      return { success: false, error: 'Queue completed. No pending rewards left.' };
    }
    if (!state.appState.tabId && state.appState.selectedGame) {
      await dependencies.onAcquireStreamer();
    }
    if (state.appState.monitorAutoOpen) {
      await new Promise((resolve) => setTimeout(resolve, adapters.monitorAutoOpenDelayMs));
      await adapters.openMonitorDashboardWindow({ toggle: false }).catch(() => undefined);
    }

    await adapters.saveState(state);
    await adapters.saveTimingState(state);
    dependencies.onStartMonitoring();
    return { success: true };
  }

  function handleStartFarming(payload: StartFarmingPayload): Promise<StartFarmingResult> {
    return runFarmingSessionMutation(state, () => start(payload));
  }

  async function stopManually(): Promise<SuccessResult> {
    await adapters.trackActivity('stop-farming');
    await stop({ stopReason: 'user-stop', stopMessage: 'Stopped by user.' });
    return { success: true };
  }

  function handleStopFarming(): Promise<SuccessResult> {
    return runFarmingSessionMutation(state, stopManually);
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

  async function handleRefreshDrops(): Promise<SuccessResult> {
    await adapters.trackActivity('refresh-drops');
    await dependencies.onRefreshDropsData({
      includeCampaignFetch: true,
      includeInventoryFetch: Boolean(state.appState.selectedGame),
      forceInventoryFetch: true,
    });
    return { success: true };
  }

  return {
    handlePauseFarming,
    handleRefreshDrops,
    handleResumeFarming,
    handleStartFarming,
    handleStopFarming,
    stop,
  };
}
