import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sanitizeTwitchSession } from '../src/background/twitch-api/types.ts';
import { fetchTwitchIntegrityToken } from '../src/background/twitch-api/gql.ts';

// --- sanitizeTwitchSession (stricter validation) ---

describe('sanitizeTwitchSession', () => {
  test('accepts a valid session', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'abcdef1234567890',
      userId: '123456789',
      uuid: 'mysession',
    });
    expect(session).not.toBeNull();
    expect(session?.oauthToken).toBe('a'.repeat(30));
    expect(session?.userId).toBe('123456789');
  });

  test('rejects an oauthToken shorter than 20 chars', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'short',
      deviceId: 'abcdef1234567890',
    });
    expect(session).toBeNull();
  });

  test('rejects a deviceId shorter than 8 chars', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'abc',
    });
    expect(session).toBeNull();
  });

  test('rejects a deviceId with unsupported punctuation', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'not-a-hex-string!!',
    });
    expect(session).toBeNull();
  });

  test('accepts a valid hex deviceId', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'abcdef1234567890abcdef12',
    });
    expect(session).not.toBeNull();
  });

  test('accepts a UUID-style deviceId captured from Twitch storage', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(session).not.toBeNull();
  });

  test('accepts an underscore deviceId captured from Twitch storage', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'device_id_12345678',
    });
    expect(session).not.toBeNull();
  });

  test('rejects a deviceId with unsupported punctuation', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'bad!!device!!id',
    });
    expect(session).toBeNull();
  });

  test('strips a non-numeric userId instead of rejecting the session', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'abcdef1234567890',
      userId: 'not-a-number',
    });
    expect(session).not.toBeNull();
    expect(session?.userId).toBe('');
  });

  test('keeps a valid numeric userId', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: 'abcdef1234567890',
      userId: '987654321',
    });
    expect(session?.userId).toBe('987654321');
  });

  test('returns null when oauthToken is missing', () => {
    expect(sanitizeTwitchSession({ deviceId: 'abcdef1234567890' })).toBeNull();
  });

  test('keeps a valid session when userId is missing so auto-detect can recover it later', () => {
    const session = sanitizeTwitchSession({
      oauthToken: 'a'.repeat(30),
      deviceId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(session).not.toBeNull();
    expect(session?.userId).toBe('');
  });

  test('returns null when deviceId is missing', () => {
    expect(sanitizeTwitchSession({ oauthToken: 'a'.repeat(30) })).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(sanitizeTwitchSession(null)).toBeNull();
    expect(sanitizeTwitchSession('string')).toBeNull();
    expect(sanitizeTwitchSession(42)).toBeNull();
  });
});

// --- fetchTwitchIntegrityToken ---

const INTEGRITY_ENDPOINT = 'https://gql.twitch.tv/integrity';

const validSession = {
  oauthToken: 'a'.repeat(30),
  deviceId: 'abcdef1234567890',
  userId: '123456789',
  uuid: 'test-uuid',
  clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
};

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchTwitchIntegrityToken', () => {
  test('returns null when oauthToken is empty', async () => {
    const result = await fetchTwitchIntegrityToken({ ...validSession, oauthToken: '' });
    expect(result).toBeNull();
  });

  test('returns null when deviceId is empty', async () => {
    const result = await fetchTwitchIntegrityToken({ ...validSession, deviceId: '' });
    expect(result).toBeNull();
  });

  test('returns the token string on a successful response', async () => {
    global.fetch = async (url: RequestInfo | URL) => {
      if (String(url) === INTEGRITY_ENDPOINT) {
        return new Response(JSON.stringify({ token: 'mock-integrity-token', expiration: 9999999 }), {
          status: 200,
        });
      }
      return new Response(null, { status: 404 });
    };

    const result = await fetchTwitchIntegrityToken(validSession);
    expect(result).toBe('mock-integrity-token');
  });

  test('returns null when response body has no token field', async () => {
    global.fetch = async () =>
      new Response(JSON.stringify({ notAToken: 'something' }), { status: 200 });

    const result = await fetchTwitchIntegrityToken(validSession);
    expect(result).toBeNull();
  });

  test('returns null when token field is an empty string', async () => {
    global.fetch = async () =>
      new Response(JSON.stringify({ token: '   ' }), { status: 200 });

    const result = await fetchTwitchIntegrityToken(validSession);
    expect(result).toBeNull();
  });

  test('throws when the HTTP response status is not OK', async () => {
    global.fetch = async () => new Response(null, { status: 401 });

    await expect(fetchTwitchIntegrityToken(validSession)).rejects.toThrow('401');
  });

  test('returns null when response body is not valid JSON', async () => {
    global.fetch = async () => new Response('not json', { status: 200 });

    const result = await fetchTwitchIntegrityToken(validSession);
    expect(result).toBeNull();
  });
});
