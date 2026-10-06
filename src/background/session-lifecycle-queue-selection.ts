import { gameKey } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { expiryTime } from './campaign-priority.ts';
import { markQueueCampaignAttempted, queueRoundCandidates } from './queue-acquisition-round.ts';
import { promoteQueueHead, removeQueueEntriesForGame } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import { isCampaignStallBlocked } from './stalled-campaign-block.ts';

export function isAutomaticFavoriteSession(state: ServiceWorkerState, campaign: TwitchGame | null): boolean {
  return (
    campaign !== null &&
    !state.appState.manualQueueAuthorized &&
    state.appState.farmingSessionOrigin === 'automatic'
  );
}

export function parkCampaignAtQueueTail(state: ServiceWorkerState, campaign: TwitchGame): void {
  const key = gameKey(campaign);
  const metadata = state.appState.queueEntryMetadataByKey[key];
  const remaining = state.appState.queue.filter((queued) => gameKey(queued) !== key);
  const firstUnauthorized =
    !state.appState.manualQueueAuthorized && state.appState.farmingSessionOrigin === 'automatic'
      ? remaining.findIndex(
          (queued) => state.appState.queueEntryMetadataByKey[gameKey(queued)]?.source !== 'favorite-auto',
        )
      : -1;
  state.appState.queue =
    firstUnauthorized < 0
      ? [...remaining, campaign]
      : [...remaining.slice(0, firstUnauthorized), campaign, ...remaining.slice(firstUnauthorized)];
  if (metadata) state.appState.queueEntryMetadataByKey[key] = metadata;
}

export function prepareNextEligibleQueueHead(
  state: ServiceWorkerState,
  restrictUnauthorizedManualContinuation: boolean,
  now = Date.now(),
): TwitchGame | null {
  for (const game of [...state.appState.queue]) {
    const key = gameKey(game);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    const legacyStall =
      isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, game) &&
      metadata?.streamerRetryReason !== 'stalled-progress';
    if (
      !isExpiredGame(game) &&
      (legacyStall ||
        (metadata?.streamerWaitState === 'availability' && metadata.streamerRetryAt === undefined))
    ) {
      markQueueCampaignAttempted(state, game);
      state.appState.queueEntryMetadataByKey[key] = {
        ...(metadata ?? {
          source: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-auto' : 'manual',
          reason: state.appState.farmingSessionOrigin === 'automatic' ? 'favorite-discovered' : 'user-added',
          addedAt: now,
        }),
        streamerRetryReason: legacyStall ? 'stalled-progress' : 'no-streamers',
        streamerRetryAt: now + 60_000,
      };
    }
    if (
      state.appState.queueAcquisitionRound?.attemptedCampaignKeys.includes(gameKey(game)) &&
      isExpiredGame(game)
    ) {
      removeQueueEntriesForGame(state, game);
    }
  }
  if (state.appState.campaignPriorityMode === 'ending-soonest') {
    const attempted = new Set(state.appState.queueAcquisitionRound?.attemptedCampaignKeys ?? []);
    state.appState.queue.sort((left, right) => {
      if (restrictUnauthorizedManualContinuation) {
        const leftAuthorized =
          state.appState.queueEntryMetadataByKey[gameKey(left)]?.source === 'favorite-auto';
        const rightAuthorized =
          state.appState.queueEntryMetadataByKey[gameKey(right)]?.source === 'favorite-auto';
        if (leftAuthorized !== rightAuthorized) return Number(rightAuthorized) - Number(leftAuthorized);
      }
      const leftAttempted = attempted.has(gameKey(left));
      const rightAttempted = attempted.has(gameKey(right));
      return leftAttempted === rightAttempted
        ? leftAttempted
          ? 0
          : expiryTime(left) - expiryTime(right)
        : Number(leftAttempted) - Number(rightAttempted);
    });
  }
  const authorized = state.appState.queue.filter((game) => {
    const metadata = state.appState.queueEntryMetadataByKey[gameKey(game)];
    return !restrictUnauthorizedManualContinuation || metadata?.source === 'favorite-auto';
  });
  const candidates = new Set(queueRoundCandidates(state, authorized, now).map(gameKey));
  const index = state.appState.queue.findIndex(
    (game) =>
      candidates.has(gameKey(game)) &&
      (state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryAt ?? 0) <= now,
  );
  if (index < 0) return null;
  const [next] = state.appState.queue.splice(index, 1);
  if (!next) return null;
  state.appState.queue.unshift(next);
  const nextGame = promoteQueueHead(state);
  if (!nextGame) return null;
  resetStreamTrackingState(state);
  const nextKey = gameKey(nextGame);
  const metadata = state.appState.queueEntryMetadataByKey[nextKey];
  if (metadata) {
    const { streamerWaitState: _waitState, streamerRetryAttempts: _attempts, ...ready } = metadata;
    state.appState.queueEntryMetadataByKey[nextKey] = ready;
  }
  state.appState.completionNotified = false;
  state.appState.activeStreamer = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.previousAllDropsCount = 0;
  return nextGame;
}
