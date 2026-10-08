import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { TwitchDrop } from '../../src/types/index.ts';
import { callListener, createAddToQueueListener, createGame } from '../support/message-router-fixtures.ts';

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Drop One',
    gameId: 'game-1',
    gameName: 'Game One',
    imageUrl: 'https://example.test/drop.png',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

describe('runtime message router', () => {
  test('queues a fresh zero-percent Twitch-native reward and persists then broadcasts once', async () => {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'campaign-fresh-native',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [game];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [createDrop({ campaignId: game.campaignId, rewardKind: 'twitch-badge' })],
      hasFarmableDrops: false,
    }));

    const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload: { game } });

    expect(result.response).toEqual({ success: true, added: true, game, queueLength: 1 });
    expect(state.appState.queue).toEqual([game]);
    expect(events).toEqual(['activity', 'persist', 'broadcast']);
  });

  test('keeps duplicate campaigns distinct while preserving already-queued identity', async () => {
    const state = createServiceWorkerState();
    const campaignA = createGame({
      campaignId: 'campaign-a',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const campaignB = createGame({
      campaignId: 'campaign-b',
      campaignName: 'Second campaign',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [campaignA, campaignB];
    state.appState.queue = [campaignA];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const second = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: campaignB },
    });
    const duplicate = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: campaignA },
    });

    expect(second.response).toEqual({ success: true, added: true, game: campaignB, queueLength: 2 });
    expect(duplicate.response).toEqual({
      success: true,
      added: false,
      reason: 'already-queued',
      game: campaignA,
    });
    expect(state.appState.queue).toEqual([campaignA, campaignB]);
    expect(events).toEqual(['activity', 'persist', 'broadcast', 'activity']);
  });
});
