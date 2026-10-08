import { unresolvedFarmingTargets } from './farming-session-targets.ts';
import { resetQueueAcquisitionRound } from './queue-acquisition-round.ts';
import { setManualPriorityCampaign } from './queue-operations.ts';
import { clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type {
  CompletedQueueContext,
  QueueProgressionExecution,
  QueueSkipReason,
  StopFarmingSessionOptions,
} from './session-lifecycle-types.ts';
import { saveTimingState as saveTimingStateExt } from './state-persistence.ts';

export function resetNoProgressRotationAttempts(state: ServiceWorkerState): void {
  state.noProgressRotationAttempts = 0;
}

export function resetStreamTrackingState(state: ServiceWorkerState, preserveRecovery = false): void {
  state.invalidStreamChecks = 0;
  state.lastStreamRotationAt = 0;
  state.streamValidationGraceUntil = 0;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  state.lastTrackedDropKey = null;
  state.lastProgressAdvanceAt = 0;
  state.offlineChecks = 0;
  state.avoidStreamerName = null;
  resetNoProgressRotationAttempts(state);
  if (!preserveRecovery) clearRecoveryState(state);
}

export async function stopFarmingSession(
  state: ServiceWorkerState,
  options?: StopFarmingSessionOptions,
): Promise<void> {
  if (options?.isCurrent?.() === false) return;
  const preserveQueueContext = options?.stopReason === 'sign-in-required';
  if (!preserveQueueContext) {
    resetQueueAcquisitionRound(state);
    state.appState.manualQueueAuthorized = false;
    state.appState.queueResumeOnAvailability = false;
    state.appState.forcedCampaignKey = null;
    setManualPriorityCampaign(state, null);
    state.appState.queueEntryMetadataByKey = Object.fromEntries(
      Object.entries(state.appState.queueEntryMetadataByKey).map(([key, metadata]) => {
        if (metadata.streamerWaitState !== 'availability') return [key, metadata];
        const { streamerWaitState: _waitState, streamerRetryAt: _retryAt, ...ready } = metadata;
        return [key, ready];
      }),
    );
  }
  if (options?.onStopMonitoring) {
    options.onStopMonitoring();
  }
  resetStreamTrackingState(state);
  state.dropClaimRetryAtById.clear();
  state.dropClaimInFlight = false;
  state.monitorTickInFlight = false;
  state.tickGeneration += 1;

  if (options?.onClearRotationMetadata) {
    state.appState = {
      ...options.onClearRotationMetadata(state.appState),
      isRunning: false,
      isPaused: false,
      farmingSessionOrigin: preserveQueueContext ? state.appState.farmingSessionOrigin : null,
      activeStreamer: null,
      tabId: null,
      completionNotified: false,
    };
  } else {
    state.appState = {
      ...state.appState,
      isRunning: false,
      isPaused: false,
      farmingSessionOrigin: preserveQueueContext ? state.appState.farmingSessionOrigin : null,
      activeStreamer: null,
      tabId: null,
      completionNotified: false,
    };
  }

  if (options?.stopReason && options.onApplyStopState) {
    options.onApplyStopState(
      state,
      options.stopReason,
      options.stopMessage ?? options.notification?.message ?? null,
    );
  }
  if (options?.notification && options.onNotify) {
    await options.onNotify(options.notification.title, options.notification.message);
  }
  if (options?.stopReason && options.stopReason !== 'user-stop' && options.onSystemAlert) {
    const alertMessage = options.stopMessage ?? options.notification?.message ?? null;
    if (alertMessage) {
      await options.onSystemAlert(options.stopReason, alertMessage);
    }
  }
  if (options?.isCurrent?.() === false) return;
  if (options?.onSaveState) {
    await options.onSaveState();
    if (options.isCurrent?.() === false) return;
  }
  if (options?.skipTimingStateSave) {
    return;
  }
  if (options?.onSaveTimingState) {
    await options.onSaveTimingState(state);
  } else {
    saveTimingStateExt(state).catch(() => undefined);
  }
}

export async function finalizeCompletedQueue(
  state: ServiceWorkerState,
  context: CompletedQueueContext,
  options: QueueProgressionExecution,
): Promise<void> {
  if (!options.isCurrent()) return;
  if (unresolvedFarmingTargets(state).length > 0) return;
  resetQueueAcquisitionRound(state);
  state.appState.isRunning = false;
  state.appState.isPaused = false;
  state.appState.manualQueueAuthorized = false;
  state.appState.queueResumeOnAvailability = false;
  state.appState.forcedCampaignKey = null;
  state.appState.farmingSessionOrigin = null;
  state.appState.selectedGame = null;
  state.appState.activeStreamer = null;
  state.appState.watchHealth = null;
  state.appState.completionNotified = false;
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  const targets = Object.values(state.appState.farmingSessionTargets);
  const acquired = targets.filter((target) => target.acquired).length;
  const expired = targets.length - acquired;
  const queueCompleteMessage =
    expired > 0
      ? `Farming ended: ${acquired} campaigns acquired, ${expired} expired.`
      : targets.length > 0
        ? 'All authorized campaign rewards were acquired.'
        : 'No authorized campaigns remain.';
  const queueCompleteNotificationMessage = queueCompleteMessage;
  const stopReason = 'queue-complete';
  const stopMessage = queueCompleteMessage;
  options.onApplyStopState(state, stopReason, stopMessage);
  await options.onStopMonitoring();
  if (!options.isCurrent()) return;
  await options.onSaveState();
  if (!options.isCurrent()) return;
  void Promise.resolve()
    .then(async () => {
      await options.onSystemAlert(stopReason, stopMessage);
    })
    .catch(() => undefined);
  if (!context.terminalFarmingCompleteGame) {
    void Promise.resolve()
      .then(async () => {
        if (context.completedWhileNoStreamers) {
          if (options?.onQueueCompleteNotification) {
            await options.onQueueCompleteNotification('Queue completed', queueCompleteNotificationMessage);
          } else if (options?.onNotify) {
            await options.onNotify('Queue completed', queueCompleteNotificationMessage);
          }
        } else if (expired > 0) {
          await options.onQueueCompleteNotification?.('Campaigns ended', queueCompleteMessage);
        } else if (acquired > 0) {
          await options.onSendAlert('all-complete', queueCompleteMessage);
        }
      })
      .catch(() => undefined);
  }
}

export function queueSkipLogMessage(reason: QueueSkipReason): string {
  switch (reason) {
    case 'unfarmable':
      return 'Parking campaign while reward eligibility is unresolved';
    case 'no-streamers':
      return 'Parking campaign because no eligible Drops streamer was found';
    case 'directory-unavailable':
      return 'Parking campaign while Twitch streamer search is unavailable';
    case 'open-failed':
      return 'Parking campaign because eligible stream playback could not start';
    case 'stalled-progress':
      return 'Parking campaign after its streamers did not advance reward progress';
  }
}
