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
});
