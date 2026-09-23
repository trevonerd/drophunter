import { gameKey } from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { expiryTime } from './campaign-priority.ts';
import { queueRoundCandidates } from './queue-acquisition-round.ts';
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

export function parkBlockedCampaignAtQueueTail(state: ServiceWorkerState, campaign: TwitchGame): void {
  const key = gameKey(campaign);
  const metadata = state.appState.queueEntryMetadataByKey[key];
  state.appState.queue = [...state.appState.queue.filter((queued) => gameKey(queued) !== key), campaign];
  if (metadata) state.appState.queueEntryMetadataByKey[key] = metadata;
}

export function rotateBlockedQueueHead(state: ServiceWorkerState): void {
  const [head, ...tail] = state.appState.queue;
  if (head) state.appState.queue = [...tail, head];
}

export function prepareNextEligibleQueueHead(
  state: ServiceWorkerState,
  restrictUnauthorizedManualContinuation: boolean,
): TwitchGame | null {
  for (const game of [...state.appState.queue]) {
    if (
      state.appState.queueAcquisitionRound?.attemptedCampaignKeys.includes(gameKey(game)) &&
      isExpiredGame(game)
    ) {
      removeQueueEntriesForGame(state, game);
    }
  }
  if (state.appState.campaignPriorityMode === 'ending-soonest') {
    state.appState.queue.sort((left, right) => expiryTime(left) - expiryTime(right));
  }
  const authorized = state.appState.queue.filter((game) => {
    const metadata = state.appState.queueEntryMetadataByKey[gameKey(game)];
    return (
      (!restrictUnauthorizedManualContinuation || metadata?.source === 'favorite-auto') &&
      metadata?.streamerWaitState !== 'availability' &&
      !isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, game)
    );
  });
  const candidates = new Set(queueRoundCandidates(state, authorized).map(gameKey));
  const index = state.appState.queue.findIndex(
    (game) =>
      candidates.has(gameKey(game)) &&
      (state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryAt ?? 0) <= Date.now(),
  );
  if (index < 0) return null;
  const [next] = state.appState.queue.splice(index, 1);
  if (!next) return null;
  state.appState.queue.unshift(next);
  const nextGame = promoteQueueHead(state);
  if (!nextGame) return null;
  resetStreamTrackingState(state);
  state.appState.completionNotified = false;
  state.appState.activeStreamer = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.previousAllDropsCount = 0;
  return nextGame;
}

export function prepareQueueAcquisitionRound(state: ServiceWorkerState): boolean {
  const deadline = state.appState.queueAcquisitionRound?.nextRoundAt;
  if (deadline == null) return true;
  if (deadline > Date.now()) return false;
  return (
    prepareNextEligibleQueueHead(state, isAutomaticFavoriteSession(state, state.appState.selectedGame)) !==
    null
  );
}
