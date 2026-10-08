import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

function resetStalledHistoriesForRound(state: ServiceWorkerState, candidates: readonly TwitchGame[]): void {
  for (const game of candidates) {
    const key = gameKey(game);
    const metadata = state.appState.queueEntryMetadataByKey[key];
    if (metadata) {
      const {
        attemptedStreamerNames: _attempted,
        watchAttempt: _watch,
        streamerRetryAt: _retry,
        streamerRetryReason: _reason,
        streamerWaitState: _wait,
        ...retained
      } = metadata;
      state.appState.queueEntryMetadataByKey[key] = retained;
    }
  }
}

export const QUEUE_ROUND_RETRY_MS = 10 * 60_000;

export function resetQueueAcquisitionRound(state: ServiceWorkerState): void {
  state.appState.queueAcquisitionRound = null;
}

export function restartQueueAcquisitionRound(state: ServiceWorkerState, now = Date.now()): void {
  resetStalledHistoriesForRound(state, state.appState.queue);
  state.appState.queueAcquisitionRound = { attemptedCampaignKeys: [], nextRoundAt: now };
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
  const attempted = round.attemptedCampaignKeys;
  const untried = candidates.filter((game) => !attempted.includes(gameKey(game)));
  if (untried.length > 0) {
    state.appState.queueAcquisitionRound = { attemptedCampaignKeys: attempted, nextRoundAt: null };
    return untried;
  }
  if (round.nextRoundAt !== null && round.nextRoundAt <= now) {
    resetQueueAcquisitionRound(state);
    resetStalledHistoriesForRound(state, state.appState.queue);
    return candidates;
  }
  const earliestRetryAt = Math.min(
    now,
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
