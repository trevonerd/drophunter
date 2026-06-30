import { describe, expect, test } from 'bun:test';
import {
  assertNever,
  isRuntimeRequest,
  RUNTIME_MESSAGE_TYPES,
  type RuntimeRequest,
  type RuntimeResponseByType,
} from '../src/shared/messages';

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

  test('maps request types to response types at compile time', () => {
    type ResponseKeys = keyof RuntimeResponseByType;
    type RequestTypes = RuntimeRequest['type'];
    const _requestTypesAreResponseKeys: RequestTypes extends ResponseKeys ? true : never = true;
    const _responseKeysAreRequestTypes: ResponseKeys extends RequestTypes ? true : never = true;

    expect(_requestTypesAreResponseKeys).toBe(true);
    expect(_responseKeysAreRequestTypes).toBe(true);
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
});
