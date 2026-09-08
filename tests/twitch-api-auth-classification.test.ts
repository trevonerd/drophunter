import { describe, expect, test } from 'bun:test';
import {
  classifyTwitchApiFailure,
  isTwitchAuthFailure,
  TwitchInvalidResponseError,
} from '../src/background/twitch-api/errors.ts';
import { TwitchGqlTransport } from '../src/background/twitch-api/gql.ts';
import { isLikelyAuthError } from '../src/background/twitch-api/types.ts';

const testSession = {
  oauthToken: 'oauth-token-with-valid-length-1234567890',
  userId: '123456',
  deviceId: 'device-12345678',
  uuid: 'uuid-1',
};

describe('Twitch API authentication error classification', () => {
  test('does not treat an integrity-check rejection as an expired Twitch session', () => {
    expect(isLikelyAuthError(new Error('failed integrity check'))).toBe(false);
  });

  test('continues to identify a rejected OAuth token as an authentication error', () => {
    expect(isLikelyAuthError(new Error('invalid oauth token'))).toBe(true);
    expect(isLikelyAuthError(new Error('401 Unauthorized'))).toBe(true);
  });

  test('treats forbidden responses as transient operational failures', () => {
    expect(isLikelyAuthError(new Error('403 Forbidden'))).toBe(false);
    expect(isLikelyAuthError(new Error('forbidden'))).toBe(false);
  });

  test('classifies HTTP 200 GraphQL OAuth evidence as an auth failure', async () => {
    const originalFetch = globalThis.fetch;

    try {
      for (const message of ['Unauthorized', 'invalid oauth token']) {
        globalThis.fetch = async () =>
          new Response(JSON.stringify({ data: null, errors: [{ message }] }), { status: 200 });
        const error = await new TwitchGqlTransport(testSession)
          .postAuthorized({ operationName: 'Inventory' })
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(TwitchInvalidResponseError);
        expect(classifyTwitchApiFailure(error)).toMatchObject({ kind: 'auth' });
        expect(isTwitchAuthFailure(error)).toBe(true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps a generic HTTP 200 GraphQL service error as an invalid response', () => {
    const error = new TwitchInvalidResponseError('service error');
    expect(classifyTwitchApiFailure(error)).toMatchObject({ kind: 'invalid-response' });
    expect(isTwitchAuthFailure(error)).toBe(false);
  });
});
