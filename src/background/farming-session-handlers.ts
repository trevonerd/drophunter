import { PROGRESS_POLL_MS, STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import type { FarmingSessionContext, RefreshDropsOptions } from './farming-session-context.ts';
import { runFarmingSessionMutation } from './farming-session-revision.ts';
import {
  applyStopState,
  applyTwitchSessionRecoveryState,
  clearRecoveryState,
  clearStopState,
} from './recovery-state.ts';
import { clearRotationMetadata } from './runtime-state.ts';
import { handleStartFarming as startFarming, stopFarmingSession } from './session-lifecycle.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { StartFarmingPayload, StartFarmingResult } from './session-lifecycle-types.ts';

export type FarmingSessionStopOptions = {
  readonly skipTimingStateSave?: boolean;
  readonly notification?: { readonly title: string; readonly message: string };
  readonly stopReason?: string;
  readonly stopMessage?: string | null;
};

export type FarmingSessionAuthRecoveryOptions = {
  readonly notification?: { readonly title: string; readonly message: string };
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
  readonly handleResumeFarming: () => Promise<SuccessResult>;
  readonly handleStartFarming: (payload: StartFarmingPayload) => Promise<StartFarmingResult>;
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
      onSystemAlert: adapters.telegramSystemAlert,
      onSaveState: () => adapters.saveState(state),
      onSaveTimingState: options?.skipTimingStateSave ? undefined : adapters.saveTimingState,
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
    if (!state.appState.activeStreamer && !state.appState.tabId && state.appState.selectedGame) {
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

  async function recoverTwitchSession(options?: FarmingSessionAuthRecoveryOptions): Promise<void> {
    if (!state.appState.isRunning) return;

    state.apiConsecutiveFailures += 1;
    const retryDelayMs = Math.min(
      2 ** Math.max(0, state.apiConsecutiveFailures - 1) * PROGRESS_POLL_MS,
      10 * 60_000,
    );
    state.apiBackoffUntil = Date.now() + retryDelayMs;
    applyTwitchSessionRecoveryState(state, state.apiBackoffUntil, state.apiConsecutiveFailures);

    if (options?.notification && !state.recoveryNotificationSent) {
      state.recoveryNotificationSent = true;
      const fullMessage = `${options.notification.message} Viewing continues and farming will resume automatically.`;
      await adapters.notify(options.notification.title, fullMessage);
      await adapters.telegramSystemAlert?.('sign-in-recovery', fullMessage);
    }
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
    handlePauseFarming,
    handleResumeFarming,
    handleStartFarming,
    handleStopFarming,
    recoverTwitchSession,
    resumeAfterAuthRecovery,
    stop,
  };
}
