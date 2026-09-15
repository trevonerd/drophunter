import { afterEach, beforeEach, expect, test } from 'bun:test';
import { fetchDirectoryStreamersFromApiWrapper } from '../src/background/api-secondary-wrappers.ts';
import {
  classifyTwitchApiFailure,
  TwitchDirectoryUnavailableError,
  TwitchHttpError,
  TwitchInvalidResponseError,
} from '../src/background/twitch-api/errors.ts';
import { createSession } from './api-operations-fixtures.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

const originalFetch = globalThis.fetch;
let chrome: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  chrome = setupChromeMocks();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  chrome.teardown();
});

test.each([
  [new TwitchHttpError('gql', 401), 'auth'],
  [new TwitchHttpError('gql', 429, 120_000), 'rate-limit'],
  [new TwitchHttpError('integrity', 403), 'integrity'],
  [new TwitchInvalidResponseError('missing directory'), 'invalid-response'],
] as const)('retains typed directory cause: %s', (cause, kind) => {
  const failure = classifyTwitchApiFailure(new TwitchDirectoryUnavailableError(cause));
  expect(failure.kind).toBe(kind);
  if (kind === 'rate-limit') expect(failure.retryAfterMs).toBe(120_000);
});

test.each([
  [() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }), 'rate-limit'],
  [() => new Response('', { status: 503 }), 'network'],
  [() => Response.json({ errors: [{ message: 'failed integrity check' }] }), 'integrity'],
  [() => Response.json({ data: { game: null } }), 'invalid-response'],
] as const)('preserves actual HTTP/GQL failure through the directory wrapper: %s', async (response, kind) => {
  const state = createMinimalState();
  const startedAt = Date.now();
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return response();
  };
  let caught: unknown;
  try {
    await fetchDirectoryStreamersFromApiWrapper(
      state,
      createGame(),
      false,
      '',
      {
        onEnsureTwitchSession: async () => createSession(),
        onIsLikelyAuthError: (error) => classifyTwitchApiFailure(error).kind === 'auth',
        onClearTwitchSessionCache: () => undefined,
      },
      { logWarn: () => undefined },
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TwitchDirectoryUnavailableError);
  expect(classifyTwitchApiFailure(caught).kind).toBe(kind);
  expect(requests).toBe(1);
  if (kind === 'rate-limit') {
    expect(classifyTwitchApiFailure(caught).retryAfterMs).toBe(120_000);
    expect(state.apiBackoffUntil).toBeGreaterThanOrEqual(startedAt + 120_000);
  }
});
