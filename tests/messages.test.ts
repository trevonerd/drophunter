import { describe, expect, test } from 'bun:test';
import {
  type AddToQueueReason,
  assertNever,
  BOOLEAN_TOGGLE_MESSAGES,
  isRuntimeRequest,
  NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES,
  RUNTIME_MESSAGE_TYPES,
  type RuntimeRequest,
  type RuntimeResponseByType,
} from '../src/shared/messages';
import type { AppState } from '../src/types';

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : never
    : never;

describe('runtime message protocol', () => {
  test('accepts known runtime message types and rejects unknown ones', () => {
    expect(isRuntimeRequest({ type: 'GET_STREAM_CONTEXT' })).toBe(true);
    expect(isRuntimeRequest({ type: 'UNKNOWN_MESSAGE' })).toBe(false);
    expect(isRuntimeRequest(null)).toBe(false);
  });

  test('keeps the runtime message type list unique', () => {
    expect(new Set(RUNTIME_MESSAGE_TYPES).size).toBe(RUNTIME_MESSAGE_TYPES.length);
  });

  test('validates OPEN_DROPS_PAGE_AND_REFRESH active payload', () => {
    expect(
      isRuntimeRequest({
        type: 'OPEN_DROPS_PAGE_AND_REFRESH',
        payload: { waitForRefresh: true, active: false },
      }),
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'OPEN_DROPS_PAGE_AND_REFRESH',
        payload: { active: 'nope' },
      }),
    ).toBe(false);
  });

  test('validates MARK_DROPS_REFRESH_NOTICE_SEEN payload', () => {
    expect(
      isRuntimeRequest({
        type: 'MARK_DROPS_REFRESH_NOTICE_SEEN',
        payload: { seenAt: 123 },
      }),
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'MARK_DROPS_REFRESH_NOTICE_SEEN',
        payload: { seenAt: 'later' },
      }),
    ).toBe(false);
  });

  test('validates atomic game preference payloads', () => {
    // Given: a campaign preference request with a valid game identity.
    const game = { id: 'valorant', name: 'Valorant', imageUrl: '' };

    // When: each supported preference crosses the runtime boundary.
    const valid = ['normal', 'favorite', 'hidden'].map((preference) =>
      isRuntimeRequest({ type: 'SET_GAME_PREFERENCE', payload: { game, preference } }),
    );

    // Then: only the three typed states are accepted.
    expect(valid).toEqual([true, true, true]);
    expect(isRuntimeRequest({ type: 'SET_GAME_PREFERENCE', payload: { game, preference: 'deleted' } })).toBe(
      false,
    );
    expect(isRuntimeRequest({ type: 'SET_GAME_PREFERENCE', payload: { game } })).toBe(false);
  });

  test('maps request types to response types at compile time', () => {
    type ResponseKeys = keyof RuntimeResponseByType;
    type RequestTypes = RuntimeRequest['type'];
    const _requestTypesAreResponseKeys: RequestTypes extends ResponseKeys ? true : never = true;
    const _responseKeysAreRequestTypes: ResponseKeys extends RequestTypes ? true : never = true;

    expect(_requestTypesAreResponseKeys).toBe(true);
    expect(_responseKeysAreRequestTypes).toBe(true);
  });

  test('declares optional-boolean SET messages in a response-field table', () => {
    const expectedTypes = [
      'SET_MONITOR_AUTO_OPEN',
      'SET_AUTO_RESUME_ON_STARTUP',
      'SET_MUTE_FARMING_TAB',
      'SET_NOTIFICATIONS_ENABLED',
      'SET_TELEGRAM_ALERTS_ENABLED',
      'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS',
      'SET_AUTO_CLAIM_DROPS',
      'SET_AUTO_START_FAVORITES',
    ] as const satisfies readonly RuntimeRequest['type'][];

    expect(Object.keys(BOOLEAN_TOGGLE_MESSAGES)).toEqual([...expectedTypes]);
    expect(Object.values(BOOLEAN_TOGGLE_MESSAGES).map(({ responseField }) => responseField)).toEqual([
      'monitorAutoOpen',
      'autoResumeOnStartup',
      'muteFarmingTab',
      'notificationsEnabled',
      'telegramAlertsEnabled',
      'autoClaimChannelPointsBonus',
      'autoClaimDrops',
      'autoStartFavoriteGames',
    ]);

    type ToggleResponseField =
      (typeof BOOLEAN_TOGGLE_MESSAGES)[keyof typeof BOOLEAN_TOGGLE_MESSAGES]['responseField'];
    const _responseFieldsAreAppStateKeys: ToggleResponseField extends keyof AppState ? true : never = true;
    type ToggleResponseTypes = keyof typeof BOOLEAN_TOGGLE_MESSAGES;
    const _toggleTypesAreResponseKeys: ToggleResponseTypes extends keyof RuntimeResponseByType
      ? true
      : never = true;

    expect(_responseFieldsAreAppStateKeys).toBe(true);
    expect(_toggleTypesAreResponseKeys).toBe(true);
  });

  test('declares no-payload minimal-response messages in a table', () => {
    const expectedTypes = [
      'TEST_TELEGRAM_ALERTS',
      'CLEAR_QUEUE',
      'PAUSE_FARMING',
      'RESUME_FARMING',
      'STOP_FARMING',
      'REFRESH_DROPS',
    ] as const satisfies readonly RuntimeRequest['type'][];

    expect(Object.keys(NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES)).toEqual([...expectedTypes]);

    type NoPayloadMinimalResponseType = keyof typeof NO_PAYLOAD_MINIMAL_RESPONSE_MESSAGES;
    type MinimalResponse = { success: boolean; error?: string };

    const requestShapeChecks = {
      TEST_TELEGRAM_ALERTS: true,
      CLEAR_QUEUE: true,
      PAUSE_FARMING: true,
      RESUME_FARMING: true,
      STOP_FARMING: true,
      REFRESH_DROPS: true,
    } satisfies {
      [T in NoPayloadMinimalResponseType]: IsExact<Extract<RuntimeRequest, { type: T }>, { type: T }>;
    };

    const responseShapeChecks = {
      TEST_TELEGRAM_ALERTS: true,
      CLEAR_QUEUE: true,
      PAUSE_FARMING: true,
      RESUME_FARMING: true,
      STOP_FARMING: true,
      REFRESH_DROPS: true,
    } satisfies {
      [T in NoPayloadMinimalResponseType]: IsExact<RuntimeResponseByType[T], MinimalResponse>;
    };

    expect(Object.values(requestShapeChecks).every(Boolean)).toBe(true);
    expect(Object.values(responseShapeChecks).every(Boolean)).toBe(true);
    for (const type of expectedTypes) {
      expect(isRuntimeRequest({ type })).toBe(true);
      expect(isRuntimeRequest({ type, payload: { unexpected: true } })).toBe(false);
    }
  });

  test('assertNever throws for unreachable runtime branches', () => {
    expect(() => assertNever('unexpected' as never)).toThrow('Unhandled runtime message');
  });

  test('accepts GET_CLAIM_LOG and CLEAR_CLAIM_LOG as valid runtime requests', () => {
    expect(isRuntimeRequest({ type: 'GET_CLAIM_LOG' })).toBe(true);
    expect(isRuntimeRequest({ type: 'CLEAR_CLAIM_LOG' })).toBe(true);
    expect(isRuntimeRequest({ type: 'GET_CLAIM_LOG', payload: { unexpected: true } })).toBe(true);
  });

  test('accepts Telegram runtime requests and validates credential payloads', () => {
    expect(isRuntimeRequest({ type: 'SET_TELEGRAM_ALERTS_ENABLED', payload: { enabled: true } })).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'SET_TELEGRAM_CREDENTIALS',
        payload: { botToken: '123:abc', chatId: '999' },
      }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: 'TEST_TELEGRAM_ALERTS' })).toBe(true);
    expect(isRuntimeRequest({ type: 'GET_TELEGRAM_SETTINGS' })).toBe(true);
    expect(
      isRuntimeRequest({
        type: 'SET_TELEGRAM_CREDENTIALS',
        payload: { botToken: 123 },
      }),
    ).toBe(false);
  });

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
