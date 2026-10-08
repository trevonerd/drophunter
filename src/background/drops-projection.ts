import { mergeDropProgressMonotonic } from '../shared/drops.ts';
import {
  applyGameDisplayNames,
  compareGamesForDisplayOrder,
  dropMatchesGame,
  findMatchingGame,
  gameKey,
  isSameGameIdentity,
} from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import { preserveAcquiredCampaigns, rememberAcquiredCampaigns } from './campaign-completion-evidence.ts';
import {
  annotateGameCompletion,
  type DropsSnapshotProvenance,
  dropStateKey,
  preserveGameCompletionSummaries,
  recomputeKnownCompleteGameSummary,
  reconcileUnverifiableRewardMarkers,
} from './drops-projection-semantics.ts';
import { dropMatchesSelectedGame, splitDropsForSelectedGame } from './drops-selected-projection.ts';
import { reconcileFarmingSessionTargets } from './farming-session-targets.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type { DropsSnapshotProvenance } from './drops-projection-semantics.ts';
export {
  annotateGameCompletion,
  applyUnverifiableRewardMarker,
  clearUnverifiableRewardMarker,
  completedDropKeys,
  dropStateKey,
  hasCompleteIdentifiedRewardSet,
  isDropCampaignExpired,
  markDropUnverifiable,
  recomputeKnownCompleteGameSummary,
  reconcileUnverifiableRewardMarkers,
} from './drops-projection-semantics.ts';
export {
  compareDropPriority,
  dropMatchesSelectedGame,
  dropRemainingMinutes,
  splitDropsForSelectedGame,
} from './drops-selected-projection.ts';

export function normalizeGameSelection(
  state: ServiceWorkerState,
  games: TwitchGame[],
  _dropVanished = false,
) {
  if (!state.appState.selectedGame) {
    return;
  }
  const selected = findMatchingGame(state.appState.selectedGame, games);
  if (selected) {
    state.appState.selectedGame = selected;
  }
}

export function retainCampaignExpiryEvidence(state: ServiceWorkerState, games: readonly TwitchGame[]): void {
  const expiredGames = games.filter((game) => isExpiredGame(game));
  if (expiredGames.length === 0) return;
  normalizeGameSelection(state, expiredGames);
  state.appState.queue = state.appState.queue.map((game) => findMatchingGame(game, expiredGames) ?? game);
  state.appState.availableGames = state.appState.availableGames.filter(
    (game) => !findMatchingGame(game, expiredGames),
  );
  for (const game of expiredGames) {
    const key = gameKey(game);
    const target = state.appState.farmingSessionTargets[key];
    if (target) state.appState.farmingSessionTargets[key] = { ...target, game };
  }
}

export function recomputeSelectedCampaignSummaryAfterLocalMarker(state: ServiceWorkerState): boolean {
  const selectedGame = state.appState.selectedGame;
  if (!selectedGame) {
    return false;
  }
  const knownCompleteGame = findMatchingGame(selectedGame, state.appState.availableGames) ?? selectedGame;
  const recomputedGame = recomputeKnownCompleteGameSummary(knownCompleteGame, state.appState.allDrops);
  if (recomputedGame === knownCompleteGame) {
    return false;
  }

  const replaceSelectedCampaign = (game: TwitchGame) =>
    isSameGameIdentity(game, knownCompleteGame) ? recomputedGame : game;
  state.appState.availableGames = state.appState.availableGames.map(replaceSelectedCampaign);
  state.appState.queue = state.appState.queue.map(replaceSelectedCampaign);
  state.appState.selectedGame = recomputedGame;
  return recomputedGame.rewardSummary?.completion === 'farming-complete';
}

function campaignProgressAdvanced(
  previousDrops: readonly TwitchDrop[],
  currentDrops: readonly TwitchDrop[],
): boolean {
  const previousByKey = new Map(previousDrops.map((drop) => [dropStateKey(drop), drop]));
  return currentDrops.some((drop) => {
    const previous = previousByKey.get(dropStateKey(drop));
    return (
      previous !== undefined &&
      (drop.progress > previous.progress ||
        (drop.currentMinutes ?? -1) > (previous.currentMinutes ?? -1) ||
        (!isRewardAcquired(previous) && isRewardAcquired(drop)))
    );
  });
}

function mergeCampaignBaseline(
  game: TwitchGame,
  projectedDrops: readonly TwitchDrop[],
  cachedDrops: readonly TwitchDrop[],
): TwitchDrop[] {
  const byKey = new Map<string, TwitchDrop>();
  for (const drop of [...projectedDrops, ...cachedDrops].filter((entry) => dropMatchesGame(entry, game))) {
    const key = dropStateKey(drop);
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeDropProgressMonotonic(drop, previous) : drop);
  }
  return [...byKey.values()];
}

export function projectDropsSnapshot(
  state: ServiceWorkerState,
  snapshot: DropsSnapshot,
  provenance: DropsSnapshotProvenance,
): void {
  const previousCampaignDrops = state.appState.campaignDropsByKey;
  const previousCachedDrops = state.cachedDropsSnapshot;
  rememberAcquiredCampaigns(state.appState, state.appState.availableGames);
  const reconciledDrops = reconcileUnverifiableRewardMarkers(state, snapshot, provenance);
  if (reconciledDrops.length > 0) {
    state.cachedDropsSnapshot = reconciledDrops;
  } else if (provenance === 'campaign-authoritative' && snapshot.games.length === 0) {
    state.cachedDropsSnapshot = [];
  }
  if (snapshot.campaignChannelsMap) {
    state.cachedCampaignChannelsMap = snapshot.campaignChannelsMap;
  }
  retainCampaignExpiryEvidence(state, snapshot.games);
  const orderedGames =
    snapshot.games.length > 0
      ? applyGameDisplayNames(
          snapshot.games
            .filter((g) => !isExpiredGame(g))
            .sort((left, right) => {
              const byName = left.name.localeCompare(right.name);
              if (byName !== 0) {
                return byName;
              }
              return compareGamesForDisplayOrder(left, right);
            }),
        )
      : state.appState.availableGames;
  const gamesWithPreservedSummaries = preserveGameCompletionSummaries(
    orderedGames,
    state.appState.availableGames,
  );
  const annotatedGames = annotateGameCompletion(
    preserveAcquiredCampaigns(state.appState, gamesWithPreservedSummaries),
    reconciledDrops,
    provenance,
  );
  rememberAcquiredCampaigns(state.appState, annotatedGames);
  state.appState.availableGames = annotatedGames;
  state.appState.campaignDropsByKey = Object.fromEntries(
    annotatedGames.map((game) => [
      gameKey(game),
      reconciledDrops.filter((drop) => dropMatchesGame(drop, game)),
    ]),
  );
  if (provenance !== 'cached') {
    for (const game of annotatedGames) {
      const key = gameKey(game);
      const campaignDrops = reconciledDrops.filter((drop) => dropMatchesGame(drop, game));
      const previousDrops = mergeCampaignBaseline(
        game,
        previousCampaignDrops[key] ?? [],
        previousCachedDrops,
      );
      if (!campaignProgressAdvanced(previousDrops, campaignDrops)) continue;
      delete state.appState.campaignFailureEpisodesByKey[key];
      const metadata = state.appState.queueEntryMetadataByKey[key];
      if (metadata) {
        const {
          streamerRetryAt: _at,
          streamerRetryReason: _reason,
          streamerWaitState: _wait,
          attemptedStreamerNames: _attempted,
          parkedStreamerNames: _parked,
          watchAttempt: _watch,
          ...ready
        } = metadata;
        state.appState.queueEntryMetadataByKey[key] = ready;
      }
    }
  }
  normalizeGameSelection(state, annotatedGames);
  splitDropsForSelectedGame(state, reconciledDrops, provenance !== 'cached');
  if (state.appState.isRunning) reconcileFarmingSessionTargets(state);
}

// Idle-campaign clearing policy: when farming is idle, the selected game has no
// farmable pending drops, and there are no queue items holding the slot, drop
// the selected-game selection and reset the per-game progress projections.
// Caller owns the resetStreamTrackingState side-effect (avoids a circular import
// into queue-management).
export function clearSelectedCompletedIdleCampaignExt(state: ServiceWorkerState): void {
  if (state.appState.isRunning || !state.appState.selectedGame || state.appState.queue.length > 0) {
    return;
  }

  const selected = state.appState.selectedGame;
  const selectedDrops = state.cachedDropsSnapshot.filter((drop) => dropMatchesSelectedGame(drop, selected));
  const hasKnownDrops = selectedDrops.length > 0;
  const hasFarmablePending = selectedDrops.some((drop) => isRewardFarmableNow(drop));

  if (!hasKnownDrops || hasFarmablePending) {
    return;
  }

  state.appState.selectedGame = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.appState.completionNotified = false;
  state.previousAllDropsCount = 0;
}

// Caller (service-worker wrapper) owns the farmingSession.stop / terminal-stop
// clearing / lastSuccessfulRefreshAt / lastGamesCacheRefreshAt / resetStreamTrackingState
// / saveState orchestration.
export function resetStateForAuthoritativeEmptyCampaignExt(state: ServiceWorkerState): void {
  state.appState.availableGames = [];
  // Absence from Twitch's current directory is not reward acquisition or expiry.
  if (state.appState.isRunning || state.appState.isPaused) return;
  state.appState.queue = [];
  state.appState.queueEntryMetadataByKey = {};
  state.appState.selectedGame = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.campaignDropsByKey = {};
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.appState.completionNotified = false;
  state.cachedDropsSnapshot = [];
  state.cachedCampaignChannelsMap = {};
  state.previousAllDropsCount = 0;
  state.unverifiableRewardsByKey = {};
}
