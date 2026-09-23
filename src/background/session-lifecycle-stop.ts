import { formatFarmingCompleteStatusLines } from '../shared/runtime-status.ts';
import { resetQueueAcquisitionRound } from './queue-acquisition-round.ts';
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
  state.playbackAttentionWarningSent = false;
  if (!preserveRecovery) clearRecoveryState(state);
}

export async function stopFarmingSession(
  state: ServiceWorkerState,
  options?: StopFarmingSessionOptions,
): Promise<void> {
  const preserveQueueContext = options?.stopReason === 'sign-in-required';
  if (!preserveQueueContext) {
    resetQueueAcquisitionRound(state);
    state.appState.manualQueueAuthorized = false;
    state.appState.queueResumeOnAvailability = false;
    state.appState.forcedCampaignKey = null;
    state.appState.queueEntryMetadataByKey = Object.fromEntries(
      Object.entries(state.appState.queueEntryMetadataByKey).map(([key, metadata]) => {
        if (metadata.streamerWaitState !== 'availability') return [key, metadata];
        const {
          streamerWaitState: _waitState,
          streamerRetryCycles: _cycles,
          streamerRetryAt: _retryAt,
          streamerRetryReason: _retryReason,
          streamerRetryAttempts: _attempts,
          ...ready
        } = metadata;
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

  if (options?.onCloseManagedTab) {
    await options.onCloseManagedTab(state.appState.tabId);
  }

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
  if (options?.isCurrent?.() === false) return;
  resetQueueAcquisitionRound(state);
  if (options?.onCloseManagedTabIfSafe) {
    await options.onCloseManagedTabIfSafe(state.appState.tabId);
    if (options.isCurrent?.() === false) return;
  }
  if (options?.onClearManagedTabOwnership) {
    options.onClearManagedTabOwnership();
  }
  state.appState.isRunning = false;
  state.appState.isPaused = false;
  state.appState.manualQueueAuthorized = false;
  state.appState.queueResumeOnAvailability = false;
  state.appState.forcedCampaignKey = null;
  state.appState.farmingSessionOrigin = null;
  state.appState.selectedGame = context.terminalFarmingCompleteGame;
  state.appState.completionNotified = false;
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  const queueCompleteMessage = context.completedWhileNoStreamers
    ? `Queue completed. No eligible streamer was found for ${context.completedGameName}.`
    : 'Queue completed. No pending rewards left.';
  const queueCompleteNotificationMessage = context.completedWhileNoStreamers
    ? `No eligible streamer was found for the Drops in ${context.completedGameName}. DropHunter has stopped.`
    : queueCompleteMessage;
  const farmingCompleteReasons = context.terminalFarmingCompleteGame?.rewardSummary?.remainderReasons ?? [];
  const farmingCompleteLines = formatFarmingCompleteStatusLines(farmingCompleteReasons);
  const stopReason = context.terminalFarmingCompleteGame
    ? farmingCompleteReasons.includes('unverifiable-twitch')
      ? 'unverifiable-twitch'
      : 'farming-complete'
    : 'queue-complete';
  const stopMessage = context.terminalFarmingCompleteGame
    ? farmingCompleteLines.join('\n') || 'Farming finished.'
    : queueCompleteMessage;
  if (options?.onApplyStopState) {
    options.onApplyStopState(state, stopReason, stopMessage);
  }
  if (options?.onSystemAlert) {
    await options.onSystemAlert(stopReason, stopMessage);
    if (options.isCurrent?.() === false) return;
  }
  if (options?.onStopMonitoring) {
    options.onStopMonitoring();
  }
  if (!context.terminalFarmingCompleteGame) {
    if (context.completedWhileNoStreamers) {
      if (options?.onQueueCompleteNotification) {
        await options.onQueueCompleteNotification('Queue completed', queueCompleteNotificationMessage);
      } else if (options?.onNotify) {
        await options.onNotify('Queue completed', queueCompleteNotificationMessage);
      }
    } else if (options?.onSendAlert) {
      await options.onSendAlert('all-complete', queueCompleteMessage);
    }
  }
  if (options?.onSaveState) {
    if (options?.isCurrent?.() === false) return;
    await options.onSaveState();
  }
}

export function queueSkipCopy(reason: QueueSkipReason, gameName: string): QueueSkipCopy {
  switch (reason) {
    case 'unfarmable': {
      const message = `The ${gameName} campaign is no longer farmable. DropHunter is moving to the next campaign.`;
      return {
        logMessage: 'Removing campaign after an authoritative refresh proved it unfarmable',
        skipNotificationTitle: 'Campaign no longer farmable',
        skipMessage: message,
        terminalNotificationTitle: 'Campaign no longer farmable',
        terminalMessage: message,
        terminalNotificationMessage: message,
        stopReason: 'queue-complete',
      };
    }
    case 'no-streamers':
      return {
        logMessage: 'Parking campaign because no eligible Drops streamer was found',
        skipNotificationTitle: 'Campaign queued: waiting for streamers',
        skipMessage: `Kept ${gameName} queued for retry — no eligible streamer was found for its Drops.`,
        terminalNotificationTitle: 'Farming stopped: no eligible streamers',
        terminalMessage: `Farming stopped after repeated attempts because no eligible streamer was found for ${gameName}, and no other campaign can be farmed right now.`,
        terminalNotificationMessage: `No eligible streamer was found for the Drops in ${gameName} after repeated attempts. DropHunter has stopped.`,
        stopReason: 'queue-retries-exhausted',
      };
    case 'directory-unavailable':
      return {
        logMessage: 'Parking campaign because Twitch streamer search is unavailable',
        skipNotificationTitle: 'Campaign queued: Twitch search unavailable',
        skipMessage: `Kept ${gameName} queued for retry — Twitch streamer search is temporarily unavailable.`,
        terminalNotificationTitle: 'No active campaigns',
        terminalMessage: 'No active campaigns remain in the queue.',
        terminalNotificationMessage: 'No active campaigns remain in the queue.',
        stopReason: 'no-active-campaigns',
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
