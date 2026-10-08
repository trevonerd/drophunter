import { describe, expect, test } from 'bun:test';
import { trySanitizeSessionCandidate } from '../../src/background/session-management.ts';

describe('trySanitizeSessionCandidate', () => {
  test('returns sanitized session for valid input', () => {
    const raw = {
      oauthToken: 'oauth12345678901234567890',
      userId: '12345678',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'abc12345',
    };
    const result = trySanitizeSessionCandidate(raw);
    expect(result).not.toBeNull();
    expect(result?.oauthToken).toBe('oauth12345678901234567890');
  });

  test('returns null for invalid input (missing oauthToken)', () => {
    const raw = { userId: '12345678' };
    expect(trySanitizeSessionCandidate(raw)).toBeNull();
  });

  test('returns null for invalid input (missing deviceId)', () => {
    const raw = { oauthToken: 'oauth12345678901234567890' };
    expect(trySanitizeSessionCandidate(raw)).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(trySanitizeSessionCandidate('not an object')).toBeNull();
    expect(trySanitizeSessionCandidate(null)).toBeNull();
    expect(trySanitizeSessionCandidate(123)).toBeNull();
  });

  test('returns null for token shorter than 20 chars', () => {
    const raw = {
      oauthToken: 'short',
      deviceId: 'device-abc-12345678901234567',
    };
    expect(trySanitizeSessionCandidate(raw)).toBeNull();
  });
});
