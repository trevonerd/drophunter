import { formatFarmingCompleteStatusLines } from '../shared/runtime-status.ts';
import { clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type {
  AdvanceQueueOptions,
  CompletedQueueContext,
  QueueSkipCopy,
  QueueSkipReason,
  StopFarmingSessionOptions,
} from './session-lifecycle-types.ts';
import { saveTimingState as saveTimingStateExt } from './state-persistence.ts';

export function resetNoProgressRotationAttempts(state: ServiceWorkerState): void {
  state.noProgressRotationAttempts = 0;
}

export function resetStreamTrackingState(state: ServiceWorkerState): void {
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
  state.playbackAttentionWarningSent = false;
  clearRecoveryState(state);
}

export async function stopFarmingSession(
  state: ServiceWorkerState,
  options?: StopFarmingSessionOptions,
): Promise<void> {
  if (options?.onStopMonitoring) {
    options.onStopMonitoring();
  }
  resetStreamTrackingState(state);
  state.dropClaimRetryAtById.clear();
  state.dropClaimInFlight = false;
  state.monitorTickInFlight = false;
  state.tickGeneration += 1;

  if (options?.onCloseManagedTab) {
    await options.onCloseManagedTab(state.appState.tabId);
  }

  if (options?.onClearRotationMetadata) {
    state.appState = {
      ...options.onClearRotationMetadata(state.appState),
      isRunning: false,
      isPaused: false,
      activeStreamer: null,
      tabId: null,
      completionNotified: false,
    };
  } else {
    state.appState = {
      ...state.appState,
      isRunning: false,
      isPaused: false,
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
  if (options?.onSaveState) {
    await options.onSaveState();
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
  options?: AdvanceQueueOptions,
): Promise<void> {
  if (options?.onCloseManagedTabIfSafe) {
    await options.onCloseManagedTabIfSafe(state.appState.tabId);
  }
  if (options?.onClearManagedTabOwnership) {
    options.onClearManagedTabOwnership();
  }
  state.appState.isRunning = false;
  state.appState.isPaused = false;
  state.appState.selectedGame = context.terminalFarmingCompleteGame;
  state.appState.completionNotified = false;
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  const queueCompleteMessage = context.completedWhileNoStreamers
    ? `Queue completed. No live streamers found for ${context.completedGameName}.`
    : 'Queue completed. No pending rewards left.';
  const queueCompleteNotificationMessage = context.completedWhileNoStreamers
    ? `No live streamers found for ${context.completedGameName}. DropHunter has stopped.`
    : queueCompleteMessage;
  const farmingCompleteReasons = context.terminalFarmingCompleteGame?.rewardSummary?.remainderReasons ?? [];
  const farmingCompleteLines = formatFarmingCompleteStatusLines(farmingCompleteReasons);
  if (options?.onApplyStopState) {
    options.onApplyStopState(
      state,
      context.terminalFarmingCompleteGame
        ? farmingCompleteReasons.includes('unverifiable-twitch')
          ? 'unverifiable-twitch'
          : 'farming-complete'
        : 'queue-complete',
      context.terminalFarmingCompleteGame
        ? farmingCompleteLines.join('\n') || 'Farming finished.'
        : queueCompleteMessage,
    );
  }
  if (options?.onStopMonitoring) {
    options.onStopMonitoring();
  }
  if (!context.terminalFarmingCompleteGame) {
    if (context.completedWhileNoStreamers && options?.onNotify) {
      await options.onNotify('Queue completed', queueCompleteNotificationMessage);
    } else if (options?.onSendAlert) {
      await options.onSendAlert('all-complete', queueCompleteMessage);
    }
  }
  if (options?.onSaveState) {
    await options.onSaveState();
  }
}

export function queueSkipCopy(reason: QueueSkipReason, gameName: string): QueueSkipCopy {
  switch (reason) {
    case 'no-streamers':
      return {
        logMessage: 'Skipping game because no live streamers were found',
        skipNotificationTitle: 'Game skipped: no live streamers',
        skipMessage: `Skipped ${gameName} — no live streamers were found.`,
        terminalNotificationTitle: 'Queue completed',
        terminalMessage: `Queue completed. No live streamers found for ${gameName}.`,
        terminalNotificationMessage: `No live streamers found for ${gameName}. DropHunter has stopped.`,
        stopReason: 'queue-complete',
      };
    case 'unverifiable-twitch':
      return {
        logMessage: 'Finishing campaign because Twitch reward acquisition could not be verified',
        skipNotificationTitle: 'Campaign farming finished',
        skipMessage: `Finished farming ${gameName} — Twitch reward acquisition could not be verified.`,
        terminalNotificationTitle: 'Farming finished',
        terminalMessage: `Farming finished for ${gameName} — Twitch reward acquisition could not be verified and no other farmable games are queued.`,
        terminalNotificationMessage: `Twitch reward acquisition could not be verified for ${gameName}. DropHunter has stopped.`,
        stopReason: 'unverifiable-twitch',
      };
    case 'stalled-progress':
      return {
        logMessage: 'Giving up on game after stalled drop progress',
        skipNotificationTitle: 'Game skipped: no drop progress',
        skipMessage: `Skipped ${gameName} — stream opened but drop progress did not resume.`,
        terminalNotificationTitle: 'Farming stopped: no drop progress',
        terminalMessage: `Farming stopped — ${gameName} opened a stream but drop progress did not resume and no other games are queued.`,
        terminalNotificationMessage: `${gameName} opened a stream but drop progress did not resume. DropHunter has stopped.`,
        stopReason: 'stall-skipped',
      };
    default: {
      const exhaustiveReason: never = reason;
      throw new TypeError(`Unhandled queue skip reason: ${exhaustiveReason}`);
    }
  }
}
