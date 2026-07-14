import { isDropCompleted, mergeDropProgressMonotonic } from '../shared/drops.ts';
import {
  applyGameDisplayNames,
  compareGamesForDisplayOrder,
  dropMatchesGame,
  findMatchingGame,
} from '../shared/game-selection.ts';
import { normalizeToken, tokenOverlapScore } from '../shared/matching.ts';
import { clearRecoveryStatus } from '../shared/runtime-status.ts';
import { isExpiredGame } from '../shared/utils.ts';
import { DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import type { ServiceWorkerState } from './runtime-state.ts';
import { detectRecoveryProof, didDropMinutesAdvance } from './stream-rotation.ts';

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

export function dropStateKey(drop: TwitchDrop): string {
  return `${drop.id}::${drop.campaignId ?? ''}`;
}

export function completedDropKeys(drops: TwitchDrop[]): Set<string> {
  return new Set(drops.map((drop) => dropStateKey(drop)));
}

export function isDropCampaignExpired(drop: TwitchDrop): boolean {
  if (!drop.endsAt) return false;
  const endsAtMs = new Date(drop.endsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
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
    (drop) => isDropCompleted(drop) || !isDropCampaignExpired(drop),
  );

  const completed = relevantForState
    .filter((drop) => isDropCompleted(drop))
    .map((drop) => ({ ...drop, status: 'completed' as const }));
  const pending = relevantForState.filter((drop) => !isDropCompleted(drop));
  const normalizedPending = pending.map((drop) => ({
    ...drop,
    status: drop.progress > 0 || drop.claimable === true ? ('active' as const) : ('pending' as const),
  }));
  const farmablePending = normalizedPending.filter((drop) => drop.dropType !== 'event-based');
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

  if (recoveryProof) {
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

  const minuteAdvance =
    !recoveryProof && nextDropKey !== null && didDropMinutesAdvance(prevTrackedMinutes, nextCurrentMinutes);
  if (minuteAdvance) {
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

export function annotateGameCompletion(games: TwitchGame[], drops: TwitchDrop[]): TwitchGame[] {
  return games.map((game) => {
    const matching = drops.filter((drop) => dropMatchesSelectedGame(drop, game));
    const allCompleted = matching.length > 0 && matching.every((d) => isDropCompleted(d));
    return allCompleted !== (game.allDropsCompleted ?? false)
      ? { ...game, allDropsCompleted: allCompleted }
      : game;
  });
}

export function projectDropsSnapshot(state: ServiceWorkerState, snapshot: DropsSnapshot) {
  if (Array.isArray(snapshot.drops) && snapshot.drops.length > 0) {
    state.cachedDropsSnapshot = snapshot.drops as TwitchDrop[];
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
  const annotatedGames = annotateGameCompletion(orderedGames, snapshot.drops);
  state.appState.availableGames = annotatedGames;
  normalizeGameSelection(state, annotatedGames);
  splitDropsForSelectedGame(state, snapshot.drops);
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
  const hasFarmablePending = selectedDrops.some(
    (drop) => !isDropCompleted(drop) && drop.dropType !== 'event-based',
  );

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

// Pure 12-field state reset for the authoritative-empty campaign flow.
// Caller (service-worker wrapper) owns the farmingSession.stop / terminal-stop
// clearing / lastSuccessfulRefreshAt / lastGamesCacheRefreshAt / resetStreamTrackingState
// / saveState orchestration.
export function resetStateForAuthoritativeEmptyCampaignExt(state: ServiceWorkerState): void {
  state.appState.availableGames = [];
  state.appState.queue = [];
  state.appState.selectedGame = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.appState.completionNotified = false;
  state.cachedDropsSnapshot = [];
  state.cachedCampaignChannelsMap = {};
  state.previousAllDropsCount = 0;
}

// Streak policy for one-shot callers that can't internally retry: bump the
// streak counter, decide whether the empty campaign is confirmed. Callers that
// want single-observation acceptance pass `requireConsecutive = false` and
// every observation is treated as confirmed (streak still tracked for
// observability but reset when `accept` is true).
export function recordEmptyCampaignObservation(
  state: ServiceWorkerState,
  requireConsecutive: boolean,
): { accept: boolean; confirmed: boolean; streak: number } {
  if (!requireConsecutive) {
    state.emptyCampaignRefreshStreak = 0;
    return { accept: true, confirmed: true, streak: 0 };
  }

  const EMPTY_CAMPAIGN_CONFIRMATIONS_REQUIRED = 2;
  state.emptyCampaignRefreshStreak += 1;
  const confirmed = state.emptyCampaignRefreshStreak >= EMPTY_CAMPAIGN_CONFIRMATIONS_REQUIRED;
  if (confirmed) {
    state.emptyCampaignRefreshStreak = 0;
  }
  return { accept: true, confirmed, streak: state.emptyCampaignRefreshStreak };
}
