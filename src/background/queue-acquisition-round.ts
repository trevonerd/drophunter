import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { clearCampaignStallBlock } from './stalled-campaign-block.ts';

function resetStalledHistoriesForRound(state: ServiceWorkerState, candidates: readonly TwitchGame[]): void {
  for (const game of candidates) {
    const key = gameKey(game);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    if (metadata?.stalledStreamerNames) {
      const { stalledStreamerNames: _stalledNames, ...retained } = metadata;
      state.appState.queueEntryMetadataByKey[key] = retained;
    }
    state.appState.stalledCampaignBlocksByKey = clearCampaignStallBlock(
      state.appState.stalledCampaignBlocksByKey,
      game,
    );
  }
}

export const QUEUE_ROUND_RETRY_MS = 10 * 60_000;

export function resetQueueAcquisitionRound(state: ServiceWorkerState): void {
  state.appState.queueAcquisitionRound = null;
}

export function markQueueCampaignAttempted(state: ServiceWorkerState, game: TwitchGame): void {
  const previous = state.appState.queueAcquisitionRound;
  state.appState.queueAcquisitionRound = {
    attemptedCampaignKeys: [...new Set([...(previous?.attemptedCampaignKeys ?? []), gameKey(game)])],
    nextRoundAt: null,
  };
}

export function queueRoundCandidates(
  state: ServiceWorkerState,
  candidates: readonly TwitchGame[],
  now = Date.now(),
): readonly TwitchGame[] {
  const round = state.appState.queueAcquisitionRound;
  if (!round) return candidates;
  const keys = new Set(candidates.map(gameKey));
  const attempted = round.attemptedCampaignKeys.filter((key) => keys.has(key));
  const untried = candidates.filter((game) => !attempted.includes(gameKey(game)));
  if (untried.length > 0) {
    state.appState.queueAcquisitionRound = { attemptedCampaignKeys: attempted, nextRoundAt: null };
    return untried;
  }
  if (candidates.length === 0) {
    resetQueueAcquisitionRound(state);
    return [];
  }
  if (round.nextRoundAt !== null && round.nextRoundAt <= now) {
    resetQueueAcquisitionRound(state);
    resetStalledHistoriesForRound(state, candidates);
    return candidates;
  }
  const earliestRetryAt = Math.min(
    ...candidates.map(
      (game) => state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryAt ?? now,
    ),
  );
  state.appState.queueAcquisitionRound = {
    attemptedCampaignKeys: attempted,
    nextRoundAt: round.nextRoundAt ?? Math.max(now + QUEUE_ROUND_RETRY_MS, earliestRetryAt),
  };
  return [];
}
