// Owns runtime queue add, remove, and reorder mutations.
import { gameKey } from '../shared/game-selection';
import type { AddToQueueReason } from '../shared/messages.ts';
import type { TwitchDrop, TwitchGame } from '../types';
import {
  markQueueEntryManual,
  queueContainsGame,
  queueEntryMatchesGame,
  reorderQueue,
} from './queue-operations';
import type { ServiceWorkerState } from './service-worker';

function assertNever(value: never): never {
  throw new TypeError(`Unhandled add-to-queue completion: ${String(value)}`);
}

export interface HandleAddToQueueDeps {
  resolveGameFromState: (state: ServiceWorkerState, game: TwitchGame) => TwitchGame | null;
  evaluateDropsForGame: (
    game: TwitchGame,
    drops: TwitchDrop[],
  ) => { allDrops: TwitchDrop[]; hasFarmableDrops: boolean };
  getGameDisplayLabel: (game: TwitchGame) => string;
}

export async function handleAddToQueue(
  state: ServiceWorkerState,
  payload: { game?: TwitchGame },
  callbacks: {
    onTrackActivity: (reason: string) => Promise<void>;
    onSaveState: (state: ServiceWorkerState) => Promise<void>;
  },
  deps: HandleAddToQueueDeps,
): Promise<{
  success: boolean;
  added?: boolean;
  reason?: AddToQueueReason;
  game?: TwitchGame;
  queueLength?: number;
  error?: string;
}> {
  await callbacks.onTrackActivity('add-to-queue');
  if (!payload?.game) {
    return { success: false, error: 'No game provided.' };
  }

  const requestedGame = payload.game;
  if (queueContainsGame(state, requestedGame)) {
    return { success: true, added: false, reason: 'already-queued', game: requestedGame };
  }
  const requestedCampaignId = requestedGame.campaignId?.trim() ?? '';
  const canonicalGame = state.appState.availableGames.find(
    (candidate) => gameKey(candidate) === gameKey(requestedGame),
  );
  if (!canonicalGame && requestedCampaignId.length > 0) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  const targetGame = canonicalGame ?? deps.resolveGameFromState(state, requestedGame);
  if (!targetGame) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  if (queueContainsGame(state, targetGame)) {
    return { success: true, added: false, reason: 'already-queued', game: targetGame };
  }

  const completion = targetGame.rewardSummary?.completion;
  switch (completion) {
    case 'all-acquired':
      return { success: true, added: false, reason: 'already-completed', game: targetGame };
    case 'farming-complete':
      return { success: true, added: false, reason: 'farming-complete', game: targetGame };
    case 'farmable':
    case undefined:
      break;
    default:
      return assertNever(completion);
  }

  state.appState.queue.push(targetGame);
  markQueueEntryManual(state, targetGame);
  await callbacks.onSaveState(state);
  return { success: true, added: true, game: targetGame, queueLength: state.appState.queue.length };
}

export async function handleRemoveFromQueue(
  state: ServiceWorkerState,
  payload: { game?: TwitchGame; gameId?: string; campaignId?: string },
  callbacks: {
    onTrackActivity: (reason: string) => Promise<void>;
    onSaveState: (state: ServiceWorkerState) => Promise<void>;
  },
  deps: {
    removeGameFromQueue: (state: ServiceWorkerState, game: TwitchGame) => void;
    sameCampaignId: (left?: string | null, right?: string | null) => boolean;
  },
): Promise<{ success: boolean; removed: number; queueLength: number; error?: string }> {
  await callbacks.onTrackActivity('remove-from-queue');
  const before = state.appState.queue.length;

  const runningGame = state.appState.isRunning ? state.appState.selectedGame : null;
  const targetsRunningGame = runningGame
    ? payload?.game
      ? queueEntryMatchesGame(state, payload.game, runningGame)
      : state.appState.queue.some((queuedGame) => {
          const matchesTarget =
            (payload?.gameId !== undefined && queuedGame.id === payload.gameId) ||
            (payload?.campaignId !== undefined &&
              deps.sameCampaignId(queuedGame.campaignId, payload.campaignId));
          return matchesTarget && queueEntryMatchesGame(state, queuedGame, runningGame);
        })
    : false;

  if (targetsRunningGame) {
    return {
      success: false,
      removed: 0,
      queueLength: before,
      error: 'Cannot remove the running campaign.',
    };
  }

  if (payload?.game) {
    deps.removeGameFromQueue(state, payload.game);
  } else {
    const targetGameId = payload?.gameId;
    const targetCampaignId = payload?.campaignId;
    const removedGames = state.appState.queue.filter((game) => {
      if (targetGameId && game.id === targetGameId) return true;
      if (targetCampaignId && deps.sameCampaignId(game.campaignId, targetCampaignId)) return true;
      return false;
    });
    state.appState.queue = state.appState.queue.filter((game) => {
      if (targetGameId && game.id === targetGameId) return false;
      if (targetCampaignId && deps.sameCampaignId(game.campaignId, targetCampaignId)) return false;
      return true;
    });
    for (const game of removedGames) {
      delete state.appState.queueEntryMetadataByKey[gameKey(game)];
    }
  }

  const removed = Math.max(0, before - state.appState.queue.length);
  const selectedGame = state.appState.selectedGame;
  if (
    selectedGame &&
    !state.appState.isRunning &&
    !state.appState.queue.some((game) => queueEntryMatchesGame(state, game, selectedGame))
  ) {
    state.appState.selectedGame = state.appState.queue[0] ?? null;
  }

  await callbacks.onSaveState(state);
  return { success: true, removed, queueLength: state.appState.queue.length };
}

export async function handleReorderQueue(
  state: ServiceWorkerState,
  payload: { fromIndex?: number; toIndex?: number },
  callbacks: {
    onTrackActivity: (reason: string) => Promise<void>;
    onSaveState: (state: ServiceWorkerState) => Promise<void>;
  },
): Promise<{ success: boolean; reordered?: boolean; error?: string; queueLength?: number }> {
  await callbacks.onTrackActivity('reorder-queue');

  const fromIndex = payload?.fromIndex;
  const toIndex = payload?.toIndex;
  if (
    typeof fromIndex !== 'number' ||
    typeof toIndex !== 'number' ||
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex)
  ) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  const queueLength = state.appState.queue.length;
  if (fromIndex >= queueLength || toIndex >= queueLength) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  const runningGame = state.appState.isRunning ? state.appState.selectedGame : null;
  if (runningGame) {
    const runningIndex = state.appState.queue.findIndex((game) =>
      queueEntryMatchesGame(state, game, runningGame),
    );
    if (runningIndex >= 0 && (fromIndex <= runningIndex || toIndex <= runningIndex)) {
      return { success: false, error: 'Cannot reorder the running campaign.' };
    }
  }

  const reordered = reorderQueue(state, fromIndex, toIndex);
  if (!reordered) {
    return { success: false, error: 'Invalid queue indices.' };
  }

  state.appState.campaignPriorityMode = 'priority-list-only';

  await callbacks.onSaveState(state);
  return { success: true, reordered: true, queueLength: state.appState.queue.length };
}
