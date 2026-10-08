import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { callListener, createAddToQueueListener, createGame } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('returns farming-complete for subscription-only rewards without mutating or saving', async () => {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'campaign-subscription',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    state.appState.availableGames = [game];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload: { game } });

    expect(result.response).toEqual({
      success: true,
      added: false,
      reason: 'farming-complete',
      game,
    });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });

  test('rejects a stale explicit campaign instead of rebinding to a sibling game id', async () => {
    const state = createServiceWorkerState();
    const authoritativeSibling = createGame({
      campaignId: 'campaign-a',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const staleRequest = createGame({
      campaignId: 'campaign-b',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [authoritativeSibling];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: staleRequest },
    });

    expect(result.response).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });
});
