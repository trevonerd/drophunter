import { describe, expect, test } from 'bun:test';
import { compareCampaignDeadlines } from '../src/background/campaign-priority.ts';
import { pushGameToQueue, reorderQueue } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchGame } from '../src/types/index.ts';

function campaign(id: string, hours: number | null, gameId = 'shared'): TwitchGame {
  return {
    id: gameId,
    name: 'Shared game',
    imageUrl: '',
    campaignId: id,
    endsAt: hours === null ? undefined : new Date(Date.UTC(2030, 0, 1, hours)).toISOString(),
  };
}

describe('queue deadline insertion', () => {
  test('manual arrivals sort by expiry, then campaign identity, with unknown deadlines last', () => {
    const state = createServiceWorkerState();
    const games = [
      campaign('late', 20),
      campaign('unknown', null),
      campaign('equal-z', 10),
      campaign('early', 5),
      campaign('equal-a', 10),
    ];
    for (const game of games) pushGameToQueue(state, game);
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual([
      'early',
      'equal-a',
      'equal-z',
      'late',
      'unknown',
    ]);
    expect(state.appState.queue.map(gameKey)).toHaveLength(5);
    expect([...state.appState.queue].sort(compareCampaignDeadlines)).toEqual(state.appState.queue);
  });

  test('a manual reorder survives reload and each arrival minimizes deadline inversions', () => {
    const state = createServiceWorkerState();
    const first = campaign('first', 5);
    const second = campaign('second', 10);
    const third = campaign('third', 20);
    for (const game of [first, second, third]) pushGameToQueue(state, game);
    expect(reorderQueue(state, 2, 0)).toBe(true);
    state.appState.campaignPriorityMode = 'priority-list-only';
    state.appState = normalizeStoredAppState(structuredClone(state.appState));
    pushGameToQueue(state, campaign('between', 12));
    expect(state.appState.campaignPriorityMode).toBe('priority-list-only');
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual([
      'third',
      'first',
      'second',
      'between',
    ]);
  });

  test('the active campaign remains at the head even when an earlier campaign arrives', () => {
    const state = createServiceWorkerState();
    const active = campaign('active', 20);
    state.appState.queue = [active, campaign('later', 22)];
    state.appState.selectedGame = active;
    state.appState.isRunning = true;
    pushGameToQueue(state, campaign('urgent', 5));
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['active', 'urgent', 'later']);
  });
});
