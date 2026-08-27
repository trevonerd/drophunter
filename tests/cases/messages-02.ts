import { describe, expect, test } from 'bun:test';
import {
  type AddToQueueReason,
  isRuntimeRequest,
  type RuntimeResponseByType,
} from '../../src/shared/messages';

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : never
    : never;

describe('runtime message protocol', () => {
  test('validates REORDER_QUEUE payload', () => {
    expect(
      isRuntimeRequest({
        type: 'REORDER_QUEUE',
        payload: { fromIndex: 0, toIndex: 2 },
      }),
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'REORDER_QUEUE',
        payload: { fromIndex: -1, toIndex: 0 },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'REORDER_QUEUE',
        payload: { fromIndex: 0, toIndex: 0 },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'REORDER_QUEUE',
        payload: { fromIndex: 1.5, toIndex: 0 },
      }),
    ).toBe(false);
  });

  test('types REMOVE_FROM_QUEUE removal count as numeric', () => {
    const response: RuntimeResponseByType['REMOVE_FROM_QUEUE'] = {
      success: true,
      removed: 0,
      queueLength: 2,
    };

    expect(response.removed).toBe(0);
    expect(response.queueLength).toBe(2);
  });

  test('validates favorite-game and automation setting payloads fail-closed', () => {
    const game = { id: 'valorant', name: 'Valorant', imageUrl: '' };

    expect(isRuntimeRequest({ type: 'SET_GAME_FAVORITE', payload: { game, favorite: true } })).toBe(true);
    expect(
      isRuntimeRequest({ type: 'SET_CAMPAIGN_PRIORITY_MODE', payload: { mode: 'ending-soonest' } }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: 'SET_CAMPAIGN_PRIORITY_MODE', payload: { mode: 'fastest' } })).toBe(
      false,
    );
    expect(isRuntimeRequest({ type: 'SET_FARM_CATEGORY_SCOPE', payload: { scope: 'favorites-only' } })).toBe(
      true,
    );
    expect(isRuntimeRequest({ type: 'SET_FARM_CATEGORY_SCOPE', payload: { scope: 'selected' } })).toBe(false);
    expect(isRuntimeRequest({ type: 'SET_AUTO_START_FAVORITES', payload: { enabled: true } })).toBe(true);
    expect(isRuntimeRequest({ type: 'SET_AUTO_START_FAVORITES', payload: { enabled: 'yes' } })).toBe(false);
    expect(isRuntimeRequest({ type: 'EVALUATE_AUTO_START' })).toBe(true);
    expect(isRuntimeRequest({ type: 'EVALUATE_AUTO_START', payload: {} })).toBe(false);
  });

  test('accepts valid ADD_TO_QUEUE payloads and rejects malformed selected games', () => {
    const validGame = {
      id: 'game-1',
      name: 'Game One',
      imageUrl: 'https://example.test/game.png',
    };

    expect(isRuntimeRequest({ type: 'ADD_TO_QUEUE', payload: { game: validGame } })).toBe(true);
    expect(isRuntimeRequest({ type: 'ADD_TO_QUEUE', payload: {} })).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'ADD_TO_QUEUE',
        payload: { game: { ...validGame, id: '' } },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'ADD_TO_QUEUE',
        payload: { game: { ...validGame, imageUrl: 42 } },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'ADD_TO_QUEUE',
        payload: {
          game: {
            ...validGame,
            campaignId: 42,
          },
        },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: 'ADD_TO_QUEUE',
        payload: {
          game: {
            ...validGame,
            rewardSummary: { completion: 'farming-complete', remainderReasons: ['not-a-reason'] },
          },
        },
      }),
    ).toBe(false);
  });

  test('narrows ADD_TO_QUEUE response reasons to the finite contract', () => {
    type ExpectedReason = 'already-queued' | 'already-completed' | 'farming-complete';
    type ResponseReason = NonNullable<RuntimeResponseByType['ADD_TO_QUEUE']['reason']>;
    const _reasonTypeIsFinite = true satisfies IsExact<ResponseReason, ExpectedReason>;
    const reasonValues = [
      'already-queued',
      'already-completed',
      'farming-complete',
    ] as const satisfies readonly AddToQueueReason[];

    expect(_reasonTypeIsFinite).toBe(true);
    expect(reasonValues).toEqual(['already-queued', 'already-completed', 'farming-complete']);
  });

  test('rejects contradictory campaign reward summaries at the runtime boundary', () => {
    const baseGame = {
      id: 'game-1',
      name: 'Game One',
      imageUrl: 'https://example.test/game.png',
      dropCount: 1,
    };
    const malformedGames = [
      {
        ...baseGame,
        rewardSummary: { completion: 'all-acquired', remainderReasons: ['subscription-required'] },
      },
      {
        ...baseGame,
        rewardSummary: { completion: 'farmable', remainderReasons: ['unverifiable-twitch'] },
      },
      {
        ...baseGame,
        rewardSummary: {
          completion: 'farming-complete',
          remainderReasons: ['unverifiable-twitch', 'subscription-required'],
        },
      },
      {
        ...baseGame,
        rewardSummary: {
          completion: 'farming-complete',
          remainderReasons: ['subscription-required', 'subscription-required'],
        },
      },
      {
        ...baseGame,
        campaignId: '   ',
      },
    ];

    for (const game of malformedGames) {
      expect(isRuntimeRequest({ type: 'ADD_TO_QUEUE', payload: { game } })).toBe(false);
    }
  });

  test('accepts legacy game payloads with a valid reward summary but no positive drop count', () => {
    const legacyGame = {
      id: 'game-1',
      name: 'Game One',
      imageUrl: 'https://example.test/game.png',
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    };
    const zeroCountGame = { ...legacyGame, dropCount: 0 };

    expect(isRuntimeRequest({ type: 'START_FARMING', payload: { game: legacyGame } })).toBe(true);
    expect(isRuntimeRequest({ type: 'ADD_TO_QUEUE', payload: { game: legacyGame } })).toBe(true);
    expect(isRuntimeRequest({ type: 'START_FARMING', payload: { game: zeroCountGame } })).toBe(true);
    expect(isRuntimeRequest({ type: 'ADD_TO_QUEUE', payload: { game: zeroCountGame } })).toBe(true);
  });
});
