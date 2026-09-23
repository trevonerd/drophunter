import { gameKey } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { expiryTime } from './campaign-priority.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import { applyDirectoryUnavailableRecoveryState, applyNoStreamersRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { QueueProgressOptions } from './session-lifecycle-types.ts';
import { isCampaignStallBlocked } from './stalled-campaign-block.ts';
import { MAX_NO_STREAMERS_RETRIES } from './stream-rotation.ts';

const PARKED_QUEUE_RETRY_MS = 60_000;
export const MAX_PARKED_QUEUE_RETRY_CYCLES = 3;

export function parkCampaignForStreamerRetry(
  state: ServiceWorkerState,
  game: TwitchGame,
  reason: 'no-streamers' | 'directory-unavailable',
): void {
  const key = gameKey(game);
  const previousMetadata = state.appState.queueEntryMetadataByKey[key];
  const cycles = reason === 'no-streamers' ? (previousMetadata?.streamerRetryCycles ?? 0) + 1 : 0;
  const awaitingAvailability = reason === 'no-streamers' && cycles >= MAX_PARKED_QUEUE_RETRY_CYCLES;
  markQueueCampaignAttempted(state, game);
  if (!state.appState.queue.some((queued) => gameKey(queued) === key)) state.appState.queue.push(game);
  state.appState.queueEntryMetadataByKey[key] = {
    ...(previousMetadata ?? {
      source: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-auto' : 'manual',
      reason: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-discovered' : 'user-added',
      addedAt: Date.now(),
    }),
    streamerRetryAt: awaitingAvailability ? undefined : Date.now() + PARKED_QUEUE_RETRY_MS,
    streamerRetryReason: awaitingAvailability ? undefined : reason,
    streamerRetryAttempts: undefined,
    streamerRetryCycles: reason === 'no-streamers' ? cycles : previousMetadata?.streamerRetryCycles,
    streamerWaitState: awaitingAvailability ? 'availability' : undefined,
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
        !isExpiredGame(game) &&
        !isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, game) &&
        metadata?.streamerWaitState !== 'availability' &&
        (metadata?.streamerRetryReason !== 'no-streamers' ||
          (metadata.streamerRetryCycles ?? 0) < MAX_PARKED_QUEUE_RETRY_CYCLES)
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
  if (!metadata?.streamerRetryAt) return false;
  resetStreamTrackingState(state);
  state.appState.selectedGame = next;
  state.appState.activeStreamer = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.previousAllDropsCount = 0;
  const applyRecovery =
    metadata.streamerRetryReason === 'directory-unavailable'
      ? applyDirectoryUnavailableRecoveryState
      : applyNoStreamersRecoveryState;
  applyRecovery(
    state,
    Math.max(metadata.streamerRetryAt, state.appState.queueAcquisitionRound?.nextRoundAt ?? 0),
    MAX_NO_STREAMERS_RETRIES,
  );
  await options?.onSaveState?.();
  if (options?.isCurrent?.() === false) return true;
  await options?.onSaveTimingState?.(state);
  return true;
}

export async function suspendQueueUntilStreamerAvailable(
  state: ServiceWorkerState,
  options?: QueueProgressOptions,
): Promise<boolean> {
  if (
    !state.appState.queue.some(
      (game) => state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerWaitState === 'availability',
    )
  )
    return false;
  if (options?.isCurrent?.() === false) return false;
  resetStreamTrackingState(state);
  await options?.onStopMonitoring?.();
  await options?.onCloseManagedTabIfSafe?.(state.appState.tabId);
  if (options?.isCurrent?.() === false) return true;
  state.appState.isRunning = false;
  state.appState.isPaused = false;
  state.appState.selectedGame = null;
  state.appState.activeStreamer = null;
  state.appState.tabId = null;
  state.appState.queueResumeOnAvailability = true;
  state.appState.forcedCampaignKey = null;
  await options?.onSaveState?.();
  await options?.onSaveTimingState?.(state);
  return true;
}
