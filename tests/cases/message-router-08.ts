import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { callListener, createAddToQueueListener, createGame } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('keeps legacy game-id fallback only when the request has no campaign id', async () => {
    const state = createServiceWorkerState();
    const canonicalGame = createGame({
      campaignId: 'campaign-a',
      rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
    });
    const legacyRequest = createGame({
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.availableGames = [canonicalGame];
    const events: string[] = [];
    const listener = createAddToQueueListener(state, events, () => ({
      allDrops: [],
      hasFarmableDrops: true,
    }));

    const result = await callListener(listener, {
      type: 'ADD_TO_QUEUE',
      payload: { game: legacyRequest },
    });

    expect(result.response).toEqual({
      success: true,
      added: false,
      reason: 'farming-complete',
      game: canonicalGame,
    });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });
});
