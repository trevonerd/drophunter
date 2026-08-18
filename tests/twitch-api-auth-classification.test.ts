import { describe, expect, test } from 'bun:test';
import { isLikelyAuthError } from '../src/background/twitch-api/types.ts';

describe('Twitch API authentication error classification', () => {
  test('does not treat an integrity-check rejection as an expired Twitch session', () => {
    expect(isLikelyAuthError(new Error('failed integrity check'))).toBe(false);
  });

  test('continues to identify a rejected OAuth token as an authentication error', () => {
    expect(isLikelyAuthError(new Error('invalid oauth token'))).toBe(true);
  });
});
