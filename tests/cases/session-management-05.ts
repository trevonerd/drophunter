import { describe, expect, test } from 'bun:test';
import { findSessionCandidateDeep } from '../../src/background/session-management.ts';

describe('findSessionCandidateDeep', () => {
  test('finds session at top level', () => {
    const raw = {
      oauthToken: 'oauth12345678901234567890',
      deviceId: 'device-abc-12345678901234567',
      uuid: 'abc12345',
    };
    expect(findSessionCandidateDeep(raw)).not.toBeNull();
  });

  test('returns null when depth exceeded', () => {
    const raw = { deeply: { nested: { value: 'not-a-session' } } };
    expect(findSessionCandidateDeep(raw, 0)).toBeNull();
  });

  test('returns null for null input', () => {
    expect(findSessionCandidateDeep(null)).toBeNull();
  });

  test('parses JSON string embedded in object', () => {
    const raw = {
      key: '  {"oauthToken":"oauth12345678901234567890","deviceId":"device-abc-12345678901234567"}  ',
    };
    const result = findSessionCandidateDeep(raw);
    expect(result).not.toBeNull();
    expect(result?.oauthToken).toBe('oauth12345678901234567890');
  });

  test('returns null for string that is not JSON', () => {
    expect(findSessionCandidateDeep('not json at all')).toBeNull();
  });

  test('returns null for JSON array without session objects', () => {
    expect(findSessionCandidateDeep('[1,2,3]')).toBeNull();
  });

  test('finds session inside array', () => {
    const raw = [
      'ignore',
      { foo: 'bar' },
      {
        oauthToken: 'oauth12345678901234567890',
        deviceId: 'device-abc-12345678901234567',
      },
    ];
    const result = findSessionCandidateDeep(raw);
    expect(result).not.toBeNull();
  });

  test('finds session in nested object values', () => {
    const raw = {
      wrapper: {
        inner: {
          oauthToken: 'oauth12345678901234567890',
          deviceId: 'device-abc-12345678901234567',
        },
      },
    };
    const result = findSessionCandidateDeep(raw);
    expect(result).not.toBeNull();
  });

  test('skips non-JSON strings', () => {
    const raw = 'just some plain text without braces';
    expect(findSessionCandidateDeep(raw)).toBeNull();
  });
});
