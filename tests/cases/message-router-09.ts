import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { callListener, createAddToQueueListener, createGame } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('returns farming-complete for unverifiable and combined remainders', async () => {
    const cases = [
      ['campaign-native', ['unverifiable-twitch']],
      ['campaign-combined', ['subscription-required', 'unverifiable-twitch']],
    ] as const;

    for (const [campaignId, remainderReasons] of cases) {
      const state = createServiceWorkerState();
      const game = createGame({
        campaignId,
        rewardSummary: { completion: 'farming-complete', remainderReasons },
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
    }
  });

  test('keeps already-completed exclusive to all-acquired campaigns', async () => {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'campaign-acquired',
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
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
      reason: 'already-completed',
      game,
    });
    expect(state.appState.queue).toEqual([]);
    expect(events).toEqual(['activity']);
  });
});
