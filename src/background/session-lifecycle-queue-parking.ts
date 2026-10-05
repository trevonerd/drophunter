import { gameKey } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { QueueEntryMetadata, TwitchGame } from '../types/index.ts';
import type { AutomationEventNotification } from './automation-event-notifier.ts';
import { expiryTime } from './campaign-priority.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import {
  applyDirectoryUnavailableRecoveryState,
  applyNoStreamersRecoveryState,
  applyPlaybackStartRecoveryState,
} from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { parkCampaignAtQueueTail } from './session-lifecycle-queue-selection.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { QueueProgressOptions } from './session-lifecycle-types.ts';

const PARKED_QUEUE_RETRY_MS = 60_000;
export const MAX_PARKED_QUEUE_RETRY_CYCLES = 3;

export function queueWaitingNotification(transitionAt: number): AutomationEventNotification {
  return {
    transitionId: `queue-waiting:${transitionAt}`,
    event: 'recovery',
    campaignId: 'queue',
    telegramReason: 'recovery',
    title: 'Queue waiting for available campaigns',
    message:
      'No queued campaign has an eligible streamer right now. DropHunter will keep checking and resume farming when one becomes available.',
  };
}

export function parkCampaignForStreamerRetry(
  state: ServiceWorkerState,
  game: TwitchGame,
  reason: NonNullable<QueueEntryMetadata['streamerRetryReason']>,
): void {
  const key = gameKey(game);
  const previousMetadata = state.appState.queueEntryMetadataByKey[key];
  const cycles =
    reason === 'no-streamers' || reason === 'open-failed'
      ? (previousMetadata?.streamerRetryCycles ?? 0) + 1
      : 0;
  markQueueCampaignAttempted(state, game);
  parkCampaignAtQueueTail(state, game);
  state.appState.queueEntryMetadataByKey[key] = {
    ...(previousMetadata ?? {
      source: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-auto' : 'manual',
      reason: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-discovered' : 'user-added',
      addedAt: Date.now(),
    }),
    streamerRetryAt:
      Date.now() +
      (reason === 'open-failed' && cycles >= MAX_PARKED_QUEUE_RETRY_CYCLES
        ? 10 * PARKED_QUEUE_RETRY_MS
        : PARKED_QUEUE_RETRY_MS),
    streamerRetryReason: reason,
    streamerRetryAttempts: undefined,
    streamerRetryCycles:
      reason === 'no-streamers' || reason === 'open-failed' ? cycles : previousMetadata?.streamerRetryCycles,
    streamerWaitState: reason === 'no-streamers' ? 'availability' : undefined,
  };
}

export async function waitForParkedQueue(
  state: ServiceWorkerState,
  restrictUnauthorizedManualContinuation: boolean,
  options?: QueueProgressOptions,
): Promise<boolean> {
  if (options?.isCurrent?.() === false) return false;
  const now = Date.now();
  const parked = state.appState.queue
    .filter((game) => {
      const metadata = state.appState.queueEntryMetadataByKey[gameKey(game)];
      return (
        ((metadata?.streamerRetryAt ?? 0) > now ||
          (state.appState.queueAcquisitionRound?.nextRoundAt ?? 0) > now) &&
        (!restrictUnauthorizedManualContinuation || metadata?.source === 'favorite-auto') &&
        !isExpiredGame(game)
      );
    })
    .sort((left, right) => {
      const leftRetry = state.appState.queueEntryMetadataByKey[gameKey(left)]?.streamerRetryAt ?? 0;
      const rightRetry = state.appState.queueEntryMetadataByKey[gameKey(right)]?.streamerRetryAt ?? 0;
      return leftRetry - rightRetry || expiryTime(left) - expiryTime(right);
    });
  const next = parked[0];
  if (!next) return false;
  const metadata = state.appState.queueEntryMetadataByKey[gameKey(next)];
  const retryAt = Math.max(
    metadata?.streamerRetryAt ?? 0,
    state.appState.queueAcquisitionRound?.nextRoundAt ?? 0,
  );
  if (retryAt <= now) return false;
  const alreadyWaiting = state.appState.recoveryBackoffUntil === retryAt;
  resetStreamTrackingState(state);
  state.appState.selectedGame = next;
  state.appState.isRunning = true;
  state.appState.queueResumeOnAvailability = false;
  state.appState.activeStreamer = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.previousAllDropsCount = 0;
  const applyRecovery =
    metadata?.streamerRetryReason === 'directory-unavailable'
      ? applyDirectoryUnavailableRecoveryState
      : metadata?.streamerRetryReason === 'open-failed'
        ? applyPlaybackStartRecoveryState
        : applyNoStreamersRecoveryState;
  applyRecovery(state, retryAt, 0);
  await options?.onSaveState?.();
  if (options?.isCurrent?.() === false) return true;
  await options?.onSaveTimingState?.(state);
  if (!alreadyWaiting && options?.isCurrent?.() !== false) await options?.onQueueWaiting?.(now);
  return true;
}
