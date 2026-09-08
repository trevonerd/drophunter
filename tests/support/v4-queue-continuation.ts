import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState, type ServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { AdvanceQueueOptions } from '../../src/background/session-lifecycle-types.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame } from '../../src/types/index.ts';
import { createFarmingSessionAdapters } from '../fixtures/queue-management.ts';

export function campaign(id: string): TwitchGame {
  return {
    id: `game-${id}`,
    name: `Game ${id}`,
    imageUrl: '',
    campaignId: `campaign-${id}`,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

export function reward(game: TwitchGame, claimed = false): TwitchDrop {
  return {
    id: `drop-${game.id}`,
    name: `Reward ${game.name}`,
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    campaignId: game.campaignId,
    progress: claimed ? 100 : 10,
    currentMinutes: claimed ? 60 : 6,
    requiredMinutes: 60,
    remainingMinutes: claimed ? 0 : 54,
    claimed,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

export function setFarmableDrops(state: ServiceWorkerState, game: TwitchGame): void {
  const pending = reward(game);
  state.appState.allDrops = [pending];
  state.appState.pendingDrops = [pending];
  state.appState.currentDrop = pending;
}

export function setAutomaticCompletion(
  state: ServiceWorkerState,
  automatic: TwitchGame,
  queue: readonly TwitchGame[],
  options: { readonly preserveQueueSource?: boolean } = {},
): void {
  state.appState.isRunning = true;
  state.appState.farmingSessionOrigin = 'automatic';
  state.appState.selectedGame = automatic;
  state.appState.queue = [...queue];
  if (!options.preserveQueueSource) {
    state.appState.queueEntryMetadataByKey[gameKey(automatic)] = {
      source: 'favorite-auto',
      addedAt: 1,
      reason: 'favorite-discovered',
    };
  }
  state.appState.allDrops = [reward(automatic, true)];
  state.appState.pendingDrops = [];
  state.appState.currentDrop = null;
}

export function createContinuationProbe(
  state: ServiceWorkerState,
  next: TwitchGame,
): {
  readonly options: AdvanceQueueOptions;
  readonly opened: () => number;
} {
  let count = 0;
  return {
    options: {
      onRefreshDropsData: async () => setFarmableDrops(state, next),
      onOpenStreamer: async () => {
        count += 1;
        return true;
      },
    },
    opened: () => count,
  };
}

export async function createManualQueue(state: ServiceWorkerState, games: readonly TwitchGame[]) {
  const session = createFarmingSession(state, createFarmingSessionAdapters());
  for (const game of games) await session.handleAddToQueue({ game });
  return session;
}

export function createQueueState(): ServiceWorkerState {
  return createServiceWorkerState();
}
