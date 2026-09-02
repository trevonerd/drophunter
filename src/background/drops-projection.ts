import { mergeDropProgressMonotonic } from '../shared/drops.ts';
import {
  applyGameDisplayNames,
  compareGamesForDisplayOrder,
  dropMatchesGame,
  findMatchingGame,
  gameKey,
  isSameGameIdentity,
} from '../shared/game-selection.ts';
import { normalizeToken, tokenOverlapScore } from '../shared/matching.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { clearRecoveryStatus } from '../shared/runtime-status.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import {
  annotateGameCompletion,
  completedDropKeys,
  type DropsSnapshotProvenance,
  dropStateKey,
  isDropCampaignExpired,
  preserveGameCompletionSummaries,
  recomputeKnownCompleteGameSummary,
  reconcileUnverifiableRewardMarkers,
} from './drops-projection-semantics.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { detectRecoveryProof, didDropMinutesAdvance } from './stream-rotation.ts';

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

export function dropRemainingMinutes(drop: TwitchDrop): number {
  if (typeof drop.remainingMinutes === 'number' && Number.isFinite(drop.remainingMinutes)) {
    return Math.max(0, drop.remainingMinutes);
  }
  return Number.POSITIVE_INFINITY;
}

export function compareDropPriority(a: TwitchDrop, b: TwitchDrop): number {
  const byRemaining = dropRemainingMinutes(a) - dropRemainingMinutes(b);
  if (byRemaining !== 0) {
    return byRemaining;
  }
  if (a.progress !== b.progress) {
    return b.progress - a.progress;
  }
  return a.name.localeCompare(b.name);
}

export function dropMatchesSelectedGame(drop: TwitchDrop, selected: TwitchGame): boolean {
  return dropMatchesGame(drop, selected);
}

export function normalizeGameSelection(state: ServiceWorkerState, games: TwitchGame[], dropVanished = false) {
  if (!state.appState.selectedGame) {
    return;
  }
  const selected = findMatchingGame(state.appState.selectedGame, games);
  if (selected) {
    state.appState.selectedGame = selected;
  } else if (dropVanished && state.appState.selectedGame.campaignId) {
    state.appState.selectedGame = null;
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

export function splitDropsForSelectedGame(state: ServiceWorkerState, allDrops: TwitchDrop[]) {
  const selected = state.appState.selectedGame;
  if (!selected) {
    state.previousAllDropsCount = 0;
    state.appState.allDrops = [];
    state.appState.pendingDrops = [];
    state.appState.completedDrops = [];
    state.appState.currentDrop = null;
    state.lastTrackedDropKey = null;
    state.lastTrackedProgress = -1;
    state.lastTrackedMinutes = -1;
    return;
  }

  const previousCompletedKeys = completedDropKeys(state.appState.completedDrops);

  const strictRelevant = allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
  const selectedName = normalizeToken(selected.name);
  const shouldAllowRelaxedFallback = !selected.campaignId;
  const relaxedRelevant =
    strictRelevant.length > 0 || !shouldAllowRelaxedFallback
      ? strictRelevant
      : allDrops.filter((drop) => {
          const dropName = normalizeToken(drop.gameName);
          return (
            selectedName.length > 0 &&
            (dropName.includes(selectedName) ||
              selectedName.includes(dropName) ||
              tokenOverlapScore(dropName, selectedName) > 0.5)
          );
        });

  const relevant = relaxedRelevant;
  const previousRelevant = state.appState.allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
  const previousByKey = new Map(previousRelevant.map((drop) => [dropStateKey(drop), drop]));

  const mergedRelevant = relevant.map((drop) => {
    const previous = previousByKey.get(dropStateKey(drop));
    if (!previous) {
      return drop;
    }
    return mergeDropProgressMonotonic(drop, previous);
  });
  const mergedKeys = new Set(mergedRelevant.map((drop) => dropStateKey(drop)));
  previousRelevant
    .filter((drop) => !mergedKeys.has(dropStateKey(drop)))
    .filter((drop) => drop.claimed)
    .forEach((drop) => mergedRelevant.push(drop));

  const relevantForState = mergedRelevant.filter(
    (drop) => isRewardAcquired(drop) || !isDropCampaignExpired(drop),
  );

  const completed = relevantForState
    .filter((drop) => isRewardAcquired(drop))
    .map((drop) => ({ ...drop, status: 'completed' as const }));
  const pending = relevantForState.filter((drop) => !isRewardAcquired(drop));
  const normalizedPending = pending.map((drop) => ({
    ...drop,
    status: drop.progress > 0 || drop.claimable === true ? ('active' as const) : ('pending' as const),
  }));
  const farmablePending = normalizedPending.filter(isRewardFarmableNow);
  const activeCandidates = farmablePending.filter((drop) => drop.progress > 0 || Boolean(drop.claimable));
  const activeDrop =
    (activeCandidates.length > 0 ? activeCandidates : farmablePending).slice().sort(compareDropPriority)[0] ??
    null;
  const nextDropKey = activeDrop ? dropStateKey(activeDrop) : null;
  const nextProgress = activeDrop?.progress ?? -1;
  const nextCompletedKeys = completedDropKeys(completed);
  const prevTrackedDropKey = state.lastTrackedDropKey;
  const prevTrackedProgress = state.lastTrackedProgress;
  const prevTrackedMinutes = state.lastTrackedMinutes;
  const freshTimingState =
    prevTrackedProgress === -1 && prevTrackedMinutes === -1 && prevTrackedDropKey === null;

  state.previousAllDropsCount = state.appState.allDrops.length;
  state.appState.allDrops = relevantForState;
  state.appState.completedDrops = completed;
  state.appState.pendingDrops = normalizedPending;
  state.appState.currentDrop = activeDrop ? { ...activeDrop, status: 'active' } : null;

  state.lastTrackedDropKey = nextDropKey;
  state.lastTrackedProgress = nextProgress;

  const nextCurrentMinutes = activeDrop?.currentMinutes ?? -1;
  state.lastTrackedMinutes = Math.max(state.lastTrackedMinutes, nextCurrentMinutes);

  if (freshTimingState) {
    state.lastProgressAdvanceAt = Date.now();
    return;
  }

  const recoveryProof = detectRecoveryProof({
    previousDropKey: prevTrackedDropKey,
    previousProgress: prevTrackedProgress,
    nextDropKey,
    nextProgress,
    previousCompletedKeys,
    nextCompletedKeys,
  });

  const minuteAdvance =
    !recoveryProof && nextDropKey !== null && didDropMinutesAdvance(prevTrackedMinutes, nextCurrentMinutes);
  if (recoveryProof || minuteAdvance) {
    state.lastProgressAdvanceAt = Date.now();
    state.noProgressRotationAttempts = 0;
    state.offlineChecks = 0;
    state.avoidStreamerName = null;
    state.recoveryBackoffUntil = 0;
    state.lastRecoveryAttemptAt = 0;
    state.stalledRecoveryAttempts = 0;
    state.recoveryNotificationSent = false;
    state.appState = clearRecoveryStatus(state.appState);
  }
}

export function projectDropsSnapshot(
  state: ServiceWorkerState,
  snapshot: DropsSnapshot,
  provenance: DropsSnapshotProvenance,
): void {
  const reconciledDrops = reconcileUnverifiableRewardMarkers(state, snapshot, provenance);
  if (reconciledDrops.length > 0) {
    state.cachedDropsSnapshot = reconciledDrops;
  } else if (provenance === 'campaign-authoritative' && snapshot.games.length === 0) {
    state.cachedDropsSnapshot = [];
  }
  if (snapshot.campaignChannelsMap) {
    state.cachedCampaignChannelsMap = snapshot.campaignChannelsMap;
  }
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
  const annotatedGames = annotateGameCompletion(gamesWithPreservedSummaries, reconciledDrops, provenance);
  state.appState.availableGames = annotatedGames;
  state.appState.campaignDropsByKey = Object.fromEntries(
    annotatedGames.map((game) => [
      gameKey(game),
      reconciledDrops.filter((drop) => dropMatchesGame(drop, game)),
    ]),
  );
  normalizeGameSelection(state, annotatedGames);
  splitDropsForSelectedGame(state, reconciledDrops);
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
  const hasFarmablePending = selectedDrops.some(isRewardFarmableNow);

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
