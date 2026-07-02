import { describe, expect, test } from 'bun:test';
import {
  extractTwitchSessionFrom,
  parseCookieValue,
  parseTwilightUserEntry,
  type StorageLike,
} from '../src/content/session-extraction.ts';

function fakeStorage(data: Record<string, string> = {}): StorageLike {
  return {
    getItem(key: string) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
  };
}

describe('parseCookieValue', () => {
  test('extracts a matching cookie value', () => {
    expect(parseCookieValue('foo=bar; auth-token=abc123; other=x', 'auth-token')).toBe('abc123');
  });

  test('returns empty string when cookie is missing', () => {
    expect(parseCookieValue('foo=bar', 'auth-token')).toBe('');
  });

  test('decodes URI-encoded cookie values', () => {
    expect(parseCookieValue('device_id=a%20b', 'device_id')).toBe('a b');
  });

  test('does not match a substring of another cookie name', () => {
    expect(parseCookieValue('__Secure-auth-token=secure; auth-token=plain', 'auth-token')).toBe('plain');
  });
});

describe('parseTwilightUserEntry', () => {
  test('reads oauthToken and userId from the first store/key that has a match', () => {
    const local = fakeStorage({ 'twilight-user': JSON.stringify({ authToken: 'tok-1', userID: 'u-1' }) });
    const session = fakeStorage();
    expect(parseTwilightUserEntry([local, session])).toEqual({ oauthToken: 'tok-1', userId: 'u-1' });
  });

  test('falls back through alternate key names', () => {
    const local = fakeStorage();
    const session = fakeStorage({
      'twilight-user-data-v2': JSON.stringify({ token: 'tok-2', user: { id: 'u-2' } }),
    });
    expect(parseTwilightUserEntry([local, session])).toEqual({ oauthToken: 'tok-2', userId: 'u-2' });
  });

  test('ignores malformed JSON and keeps scanning', () => {
    const local = fakeStorage({
      'twilight-user': 'not-json',
      'twilight-session': JSON.stringify({ accessToken: 'tok-3' }),
    });
    expect(parseTwilightUserEntry([local])).toEqual({ oauthToken: 'tok-3', userId: '' });
  });

  test('returns empty result when nothing usable is found', () => {
    expect(parseTwilightUserEntry([fakeStorage(), fakeStorage()])).toEqual({ oauthToken: '', userId: '' });
  });
});

describe('extractTwitchSessionFrom', () => {
  const createSessionUuid = () => 'generated-uuid';

  test('builds a full session from twilight storage data', () => {
    const local = fakeStorage({
      'twilight-user': JSON.stringify({ authToken: 'tok', userID: 'user-1' }),
      device_id: 'device-1',
      'client-session-id': 'uuid-1',
      'client-integrity': 'integrity-1',
    });
    const session = fakeStorage();

    const result = extractTwitchSessionFrom({
      cookieString: '',
      localStorage: local,
      sessionStorage: session,
      createSessionUuid,
    });

    expect(result).toEqual({
      oauthToken: 'tok',
      userId: 'user-1',
      deviceId: 'device-1',
      uuid: 'uuid-1',
      clientIntegrity: 'integrity-1',
    });
  });

  test('falls back to cookies for oauthToken and deviceId when storage is empty', () => {
    const empty = fakeStorage();

    const result = extractTwitchSessionFrom({
      cookieString: 'auth-token=cookie-tok; unique_id=cookie-device',
      localStorage: empty,
      sessionStorage: empty,
      createSessionUuid,
    });

    expect(result).toEqual({
      oauthToken: 'cookie-tok',
      userId: '',
      deviceId: 'cookie-device',
      uuid: 'generated-uuid',
      clientIntegrity: undefined,
    });
  });

  test('generates a uuid when none is stored', () => {
    const local = fakeStorage({
      'twilight-user': JSON.stringify({ authToken: 'tok' }),
      device_id: 'device-1',
    });
    const empty = fakeStorage();

    const result = extractTwitchSessionFrom({
      cookieString: '',
      localStorage: local,
      sessionStorage: empty,
      createSessionUuid,
    });

    expect(result?.uuid).toBe('generated-uuid');
  });

  test('returns null when oauthToken cannot be found', () => {
    const empty = fakeStorage();
    const result = extractTwitchSessionFrom({
      cookieString: '',
      localStorage: empty,
      sessionStorage: empty,
      createSessionUuid,
    });
    expect(result).toBeNull();
  });

  test('returns null when deviceId cannot be found even with a valid oauthToken', () => {
    const local = fakeStorage({ 'twilight-user': JSON.stringify({ authToken: 'tok' }) });
    const empty = fakeStorage();
    const result = extractTwitchSessionFrom({
      cookieString: '',
      localStorage: local,
      sessionStorage: empty,
      createSessionUuid,
    });
    expect(result).toBeNull();
  });
});
