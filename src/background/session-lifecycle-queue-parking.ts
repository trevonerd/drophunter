import { gameKey } from '../shared/game-selection.ts';
import { applyRecoveryStatus } from '../shared/runtime-status.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { QueueEntryMetadata, TwitchGame } from '../types/index.ts';
import { expiryTime } from './campaign-priority.ts';
import { unresolvedFarmingTargets } from './farming-session-targets.ts';
import { markQueueCampaignAttempted, QUEUE_ROUND_RETRY_MS } from './queue-acquisition-round.ts';
import {
  applyDirectoryUnavailableRecoveryState,
  applyNoStreamersRecoveryState,
  applyPlaybackStartRecoveryState,
} from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { hasCompletedCampaignWatchTime } from './session-lifecycle-completion.ts';
import { parkCampaignAtQueueTail } from './session-lifecycle-queue-selection.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { QueueProgressionExecution } from './session-lifecycle-types.ts';

export function parkCampaignForStreamerRetry(
  state: ServiceWorkerState,
  game: TwitchGame,
  reason: NonNullable<QueueEntryMetadata['streamerRetryReason']>,
  preserveQueuePosition = false,
  now = Date.now(),
): void {
  const key = gameKey(game);
  const previousMetadata = state.appState.queueEntryMetadataByKey[key];
  if (!preserveQueuePosition) {
    markQueueCampaignAttempted(state, game);
    parkCampaignAtQueueTail(state, game);
  }
  state.appState.queueEntryMetadataByKey[key] = {
    ...(previousMetadata ?? {
      source: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-auto' : 'manual',
      reason: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-discovered' : 'user-added',
      addedAt: now,
    }),
    streamerRetryAt: now + QUEUE_ROUND_RETRY_MS,
    streamerRetryReason: reason,
    streamerWaitState: reason === 'no-streamers' ? 'availability' : undefined,
    // Each park observes its own baseline of already-live streamers.
    parkedStreamerNames: undefined,
  };
}

export async function waitForParkedQueue(
  state: ServiceWorkerState,
  restrictUnauthorizedManualContinuation: boolean,
  options: QueueProgressionExecution,
): Promise<boolean> {
  if (options.isCurrent() === false) return false;
  const now = options.now();
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
  const unresolved = unresolvedFarmingTargets(state);
  const next =
    parked[0] ?? unresolved.find((game) => !hasCompletedCampaignWatchTime(state, game)) ?? unresolved[0];
  if (!next) return false;
  const watchComplete = hasCompletedCampaignWatchTime(state, next);
  const metadata = state.appState.queueEntryMetadataByKey[gameKey(next)];
  const scheduled = state.appState.queueAcquisitionRound?.nextRoundAt;
  const retryAt =
    watchComplete && (scheduled ?? 0) <= now
      ? now + QUEUE_ROUND_RETRY_MS
      : (scheduled ?? now + QUEUE_ROUND_RETRY_MS);
  state.appState.queueAcquisitionRound = {
    attemptedCampaignKeys: state.appState.queueAcquisitionRound?.attemptedCampaignKeys ?? [],
    nextRoundAt: retryAt,
  };
  if (retryAt <= now) return false;
  resetStreamTrackingState(state);
  await options.onSuspendTransport();
  if (!options.isCurrent()) return true;
  state.appState.selectedGame = next;
  state.appState.isRunning = true;
  state.appState.queueResumeOnAvailability = false;
  state.appState.activeStreamer = null;
  state.appState.watchHealth = null;
  state.previousAllDropsCount = 0;
  const applyRecovery =
    metadata?.streamerRetryReason === 'directory-unavailable'
      ? applyDirectoryUnavailableRecoveryState
      : metadata?.streamerRetryReason === 'open-failed'
        ? applyPlaybackStartRecoveryState
        : applyNoStreamersRecoveryState;
  if (watchComplete) {
    state.recoveryBackoffUntil = retryAt;
    state.appState = applyRecoveryStatus(state.appState, { reason: 'rewards-pending', retryAt, attempts: 0 });
  } else applyRecovery(state, retryAt, 0);
  await options.onSaveState();
  if (options.isCurrent() === false) return true;
  await options.onSaveTimingState(state);
  return true;
}
