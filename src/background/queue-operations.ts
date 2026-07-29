import {
  compareGamesForDisplayOrder,
  findMatchingGame,
  gameKey,
  isSameGameIdentity,
} from '../shared/game-selection';
import { normalizeToken } from '../shared/matching';
import { isExpiredGame } from '../shared/utils';
import { TwitchGame } from '../types';
import { CRASH_RECOVERY_GRACE_MS, QUEUE_MISSING_CONFIRM_THRESHOLD } from './constants';
import { logDebug } from './logging';
import type { ServiceWorkerState } from './service-worker';

// queue-operations.ts — campaign-aware queue identity + pure queue mutators.
// Owns queue shape + campaign-aware identity (see AGENTS.md: prefer campaignId;
// duplicate campaigns share game-ish IDs). Callers import these primitives
// directly when they need to advance or mutate the queue.
// Boundary: this module is a strict leaf — must NOT import from
// drops-projection.ts, stream-rotation.ts, or state-persistence.ts.

function isSameQueueIdentity(left: TwitchGame, right: TwitchGame): boolean {
  return isSameGameIdentity(left, right);
}

export function queueEntryMatchesGame(
  state: ServiceWorkerState,
  queuedGame: TwitchGame,
  game: TwitchGame,
): boolean {
  if (isSameQueueIdentity(queuedGame, game)) {
    return true;
  }
  const resolvedQueuedGame = resolveGameFromState(state, queuedGame);
  return resolvedQueuedGame !== null && isSameQueueIdentity(resolvedQueuedGame, game);
}

export function queueContainsGame(state: ServiceWorkerState, game: TwitchGame): boolean {
  return state.appState.queue.some((queuedGame) => queueEntryMatchesGame(state, queuedGame, game));
}

export function removeQueueEntriesForGame(state: ServiceWorkerState, game: TwitchGame): number {
  const before = state.appState.queue.length;
  state.appState.queue = state.appState.queue.filter(
    (queuedGame) => !queueEntryMatchesGame(state, queuedGame, game),
  );
  return before - state.appState.queue.length;
}

export function removeQueueEntriesForHeadGame(state: ServiceWorkerState, game: TwitchGame): void {
  const removed = removeQueueEntriesForGame(state, game);
  if (removed === 0 && state.appState.queue.length > 0) {
    state.appState.queue = state.appState.queue.slice(1);
  }
}

export function promoteQueueHead(state: ServiceWorkerState): TwitchGame | null {
  const queuedGame = state.appState.queue[0];
  if (!queuedGame) {
    return null;
  }
  const nextGame = resolveGameFromState(state, queuedGame);
  if (!nextGame) {
    return null;
  }
  state.appState.queue[0] = nextGame;
  state.appState.selectedGame = nextGame;
  return nextGame;
}

export function normalizeQueueSelection(
  state: ServiceWorkerState,
  games: TwitchGame[],
  dropVanished = false,
) {
  if (!Array.isArray(state.appState.queue) || state.appState.queue.length === 0) {
    state.appState.queue = [];
    state.queueMissingStreak.clear();
    return;
  }

  const inCrashGrace =
    state.appState.resumedFromCrash != null &&
    Date.now() - state.appState.resumedFromCrash < CRASH_RECOVERY_GRACE_MS;

  const normalized: TwitchGame[] = [];
  const seen = new Set<string>();
  state.appState.queue.forEach((queuedGame) => {
    const resolved = findMatchingGame(queuedGame, games);
    if (!resolved && dropVanished && queuedGame.campaignId) {
      const key = gameKey(queuedGame);
      if (inCrashGrace) {
        // First snapshot(s) right after a resume are the least trustworthy — don't count
        // them toward the missing streak at all.
      } else {
        const streak = (state.queueMissingStreak.get(key) ?? 0) + 1;
        if (streak >= QUEUE_MISSING_CONFIRM_THRESHOLD) {
          state.queueMissingStreak.delete(key);
          return;
        }
        state.queueMissingStreak.set(key, streak);
      }
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      normalized.push(queuedGame);
      return;
    }
    const game = resolved ?? queuedGame;
    state.queueMissingStreak.delete(gameKey(game));
    if (isExpiredGame(game)) {
      return;
    }
    const key = gameKey(game);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(game);
  });

  for (const key of Array.from(state.queueMissingStreak.keys())) {
    if (!seen.has(key)) {
      state.queueMissingStreak.delete(key);
    }
  }

  state.appState.queue = normalized;
}

export function removeGameFromQueue(state: ServiceWorkerState, game: TwitchGame) {
  removeQueueEntriesForGame(state, game);
}

export function resolveGameFromState(state: ServiceWorkerState, game: TwitchGame): TwitchGame | null {
  const resolved = findMatchingGame(game, state.appState.availableGames);
  if (resolved) {
    if (resolved.id !== game.id || resolved.campaignId !== game.campaignId) {
      logDebug('Resolved selected game to canonical campaign', {
        inputId: game.id,
        inputCampaignId: game.campaignId ?? null,
        inputName: game.name,
        resolvedId: resolved.id,
        resolvedCampaignId: resolved.campaignId ?? null,
        resolvedName: resolved.name,
      });
    }
    return resolved;
  }

  if (game.campaignId?.trim()) {
    const queuedResolved = findMatchingGame(game, state.appState.queue);
    if (queuedResolved) {
      return queuedResolved;
    }
    return null;
  }

  const byNameCandidates = state.appState.availableGames
    .filter((candidate) => normalizeToken(candidate.name) === normalizeToken(game.name))
    .sort((left, right) => {
      if (Boolean(left.campaignId) !== Boolean(right.campaignId)) {
        return left.campaignId ? 1 : -1;
      }
      return compareGamesForDisplayOrder(left, right);
    });
  const byNamePreferred = byNameCandidates[0];
  if (byNamePreferred) {
    logDebug('Resolved selected game by exact name fallback', {
      inputId: game.id,
      inputCampaignId: game.campaignId ?? null,
      resolvedId: byNamePreferred.id,
      resolvedCampaignId: byNamePreferred.campaignId ?? null,
      name: game.name,
    });
    return byNamePreferred;
  }

  return game;
}

export function pushGameToQueue(state: ServiceWorkerState, game: TwitchGame) {
  if (queueContainsGame(state, game)) {
    return;
  }
  state.appState.queue = [...state.appState.queue, game];
}

export function reorderQueue(state: ServiceWorkerState, fromIndex: number, toIndex: number): boolean {
  const queue = state.appState.queue;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= queue.length || toIndex >= queue.length) {
    return false;
  }
  if (fromIndex === toIndex) {
    return false;
  }

  const next = [...queue];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  state.appState.queue = next;
  return true;
}
