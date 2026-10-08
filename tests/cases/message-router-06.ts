import { describe, expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { callListener, createHandlers } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('rejects malformed ADD_TO_QUEUE payloads before invoking the handler', async () => {
    let addCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        addToQueue: async () => {
          addCalled = true;
          return { success: true, added: true };
        },
      }),
    );

    const payloads: readonly unknown[] = [
      null,
      {},
      { game: null },
      { game: { id: '', name: 'Game One', imageUrl: 'https://example.test/game.png' } },
      { game: { id: 'game-1', name: 'Game One', imageUrl: 42 } },
      { game: { id: 'game-1', name: 'Game One', imageUrl: 'https://example.test/game.png', campaignId: 42 } },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: { completion: 'farming-complete', remainderReasons: ['invalid'] },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: { completion: 'all-acquired', remainderReasons: ['subscription-required'] },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: { completion: 'farmable', remainderReasons: ['unverifiable-twitch'] },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: {
            completion: 'farming-complete',
            remainderReasons: ['unverifiable-twitch', 'subscription-required'],
          },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          rewardSummary: {
            completion: 'farming-complete',
            remainderReasons: ['subscription-required', 'subscription-required'],
          },
        },
      },
      {
        game: {
          id: 'game-1',
          name: 'Game One',
          imageUrl: 'https://example.test/game.png',
          campaignId: '   ',
        },
      },
    ];

    for (const payload of payloads) {
      const result = await callListener(listener, { type: 'ADD_TO_QUEUE', payload });
      expect(result.response).toEqual({ success: false, error: 'Invalid message payload' });
    }
    expect(addCalled).toBe(false);
  });
});
