import { describe, expect, test } from 'bun:test';
import { isRuntimeRequest } from '../src/shared/messages.ts';

describe('watch transport runtime setting', () => {
  test('accepts only the two transport modes', () => {
    expect(isRuntimeRequest({ type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'tabless' } })).toBe(true);
    expect(isRuntimeRequest({ type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'managed-tab' } })).toBe(
      true,
    );
    expect(isRuntimeRequest({ type: 'SET_WATCH_TRANSPORT_MODE', payload: { mode: 'unknown' } })).toBe(false);
  });
});
