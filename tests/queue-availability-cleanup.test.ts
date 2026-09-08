import { describe, expect, test } from 'bun:test';
import { cleanUnavailableQueueCampaigns } from '../src/background/queue-availability-cleanup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchGame } from '../src/types/index.ts';

function campaign(campaignId: string, endsAt?: string): TwitchGame {
  return {
    id: `game-${campaignId}`,
    name: `Game ${campaignId}`,
    imageUrl: '',
    campaignId,
    ...(endsAt ? { endsAt } : {}),
  };
}

describe('cleanUnavailableQueueCampaigns', () => {
  test('removes expired head and middle entries while preserving campaign order and metadata', () => {
    const state = createServiceWorkerState();
    const head = campaign('head', '2020-01-01T00:00:00.000Z');
    const middle = campaign('middle', '2020-01-01T00:00:00.000Z');
    const tail = campaign('tail');
    state.appState.queue = [head, middle, tail];
    state.appState.selectedGame = head;
    state.appState.queueEntryMetadataByKey = {
      [gameKey(head)]: { source: 'favorite-auto', addedAt: 1, reason: 'favorite-discovered' },
      [gameKey(middle)]: { source: 'manual', addedAt: 2, reason: 'user-added' },
      [gameKey(tail)]: { source: 'manual', addedAt: 3, reason: 'user-added' },
    };

    const result = cleanUnavailableQueueCampaigns(state, { now: Date.parse('2021-01-01T00:00:00.000Z') });

    expect(result.removed.map(({ game }) => game.campaignId)).toEqual(['head', 'middle']);
    expect(result.selectedRemoved).toBe(true);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.queue.map(gameKey)).toEqual([gameKey(tail)]);
    expect(state.appState.queueEntryMetadataByKey).toEqual({
      [gameKey(tail)]: { source: 'manual', addedAt: 3, reason: 'user-added' },
    });
  });

  test('removes consecutive absent campaigns only from a complete inventory-verified catalog', () => {
    const state = createServiceWorkerState();
    const first = campaign('same-game-a');
    const second = { ...campaign('same-game-b'), id: first.id };
    const manualTail = campaign('manual-tail');
    state.appState.isRunning = true;
    state.appState.selectedGame = first;
    state.appState.queue = [first, second, manualTail];

    expect(cleanUnavailableQueueCampaigns(state)).toEqual({ removed: [], selectedRemoved: false });
    const result = cleanUnavailableQueueCampaigns(state, { authoritativeGames: [manualTail] });

    expect(result.removed.map(({ game }) => game.campaignId)).toEqual(['same-game-a', 'same-game-b']);
    expect(result.selectedRemoved).toBe(true);
    expect(state.appState.selectedGame).toEqual(first);
    expect(state.appState.queue).toEqual([manualTail]);
  });

  test('clears every expired entry without changing favorites or manual authorization', () => {
    const state = createServiceWorkerState();
    const first = campaign('first', '2020-01-01T00:00:00.000Z');
    const second = campaign('second', '2020-01-01T00:00:00.000Z');
    state.appState.queue = [first, second];
    state.appState.favoriteGames = [{ gameId: first.id, lastKnownName: first.name, addedAt: 1 }];
    state.appState.manualQueueAuthorized = true;

    cleanUnavailableQueueCampaigns(state, { now: Date.parse('2021-01-01T00:00:00.000Z') });

    expect(state.appState.queue).toEqual([]);
    expect(state.appState.favoriteGames).toHaveLength(1);
    expect(state.appState.manualQueueAuthorized).toBe(true);
  });
});
