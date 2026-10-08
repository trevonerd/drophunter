import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] [TwitchApiClient] No drops-tagged streams found for "Test Game" (slug: test-game)', 1],
  [
    '[DropHunter] Twitch API directory fetch failed: TwitchInvalidResponseError: Twitch directory response is missing stream edges',
    1,
  ],
  ['[DropHunter] Twitch API directory fetch failed: TwitchHttpError: Twitch gql HTTP 429', 1],
  ['[DropHunter] Twitch API directory fetch failed: TwitchHttpError: Twitch gql HTTP 401', 1],
]);

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchDirectoryStreamersFromApiWrapper } from '../src/background/api-secondary-wrappers.ts';
import { acquireStreamerForSelectedGame } from '../src/background/streamer-acquisition.ts';
import {
  classifyTwitchApiFailure,
  TwitchDirectoryUnavailableError,
  TwitchHttpError,
} from '../src/background/twitch-api/errors.ts';
import { createSession } from './api-operations-fixtures.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('global streamer recovery', () => {
  const originalFetch = globalThis.fetch;
  const realNow = Date.now;
  let now = 5_000_000;
  let chrome: ReturnType<typeof setupChromeMocks>;

  beforeEach(() => {
    chrome = setupChromeMocks();
    now = 5_000_000;
    Date.now = () => now;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    Date.now = realNow;
    chrome.teardown();
  });

  test('does not rotate campaigns or spend empty-directory retries during global backoff', async () => {
    const state = createMinimalState();
    const first = createGame({ campaignId: 'first' });
    const second = createGame({ campaignId: 'second' });
    state.appState.selectedGame = first;
    state.appState.queue = [first, second];
    state.appState.recoveryReason = 'no-streamers';
    state.appState.recoveryAttempts = 1;
    state.apiBackoffUntil = now + 120_000;
    let opened = 0;
    let skipped = 0;

    await acquireStreamerForSelectedGame(state, {
      onOpenStreamer: async () => {
        opened += 1;
        return false;
      },
      onSkipCurrentGame: async () => {
        skipped += 1;
      },
    });

    expect(opened).toBe(0);
    expect(skipped).toBe(0);
    expect(state.appState.queue).toEqual([first, second]);
    expect(state.appState.selectedGame).toEqual(first);
    expect(state.appState.recoveryBackoffUntil).toBe(now + 120_000);
  });

  test('repeated unavailable requests preserve the selected campaign', async () => {
    const state = createMinimalState();
    const first = createGame({ campaignId: 'first' });
    state.appState.selectedGame = first;
    let skipped = 0;
    const options = {
      onOpenStreamer: async () => {
        throw new TwitchDirectoryUnavailableError(new TypeError('offline'));
      },
      onSkipCurrentGame: async () => {
        skipped += 1;
      },
    };
    await acquireStreamerForSelectedGame(state, options);
    now = state.apiBackoffUntil;
    await acquireStreamerForSelectedGame(state, options);

    expect(skipped).toBe(0);
    expect(state.appState.selectedGame).toEqual(first);
    expect(state.appState.recoveryReason).toBe('twitch-network');
    expect(state.appState.recoveryBackoffUntil).toBeGreaterThan(now);
  });

  test('missing directory shape is a global failure, not a successful empty result', async () => {
    const state = createMinimalState();
    const session = createSession();
    globalThis.fetch = async () => Response.json({ data: { game: null } });

    await expect(
      fetchDirectoryStreamersFromApiWrapper(state, createGame(), false, '', {
        onEnsureTwitchSession: async () => session,
        onIsLikelyAuthError: () => false,
        onClearTwitchSessionCache: () => undefined,
      }),
    ).rejects.toBeInstanceOf(TwitchDirectoryUnavailableError);
    expect(state.apiBackoffUntil).toBeGreaterThan(now);
  });

  test('directory cooldown rejects without making a second HTTP request', async () => {
    const state = createMinimalState();
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
    };
    const callbacks = {
      onEnsureTwitchSession: async () => createSession(),
      onIsLikelyAuthError: () => false,
      onClearTwitchSessionCache: () => undefined,
    };
    await expect(
      fetchDirectoryStreamersFromApiWrapper(state, createGame(), false, '', callbacks),
    ).rejects.toThrow();
    await expect(
      fetchDirectoryStreamersFromApiWrapper(state, createGame(), false, '', callbacks),
    ).rejects.toThrow();
    expect(requests).toBe(1);
    expect(state.apiConsecutiveFailures).toBe(1);
    expect(state.apiBackoffUntil).toBe(now + 120_000);
  });

  test.each([true, false])(
    'runs one silent session recovery before auth result (recovered=%s)',
    async (recovered) => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.manualQueueAuthorized = true;
      const session = createSession();
      let requests = 0;
      let recoveryCalls = 0;
      let signInCalls = 0;
      globalThis.fetch = async () => {
        requests += 1;
        return recovered && requests > 1
          ? Response.json({ data: { game: { streams: { edges: [] } } } })
          : new Response('', { status: 401 });
      };
      const pending = fetchDirectoryStreamersFromApiWrapper(state, createGame(), false, '', {
        onEnsureTwitchSession: async () => session,
        onIsLikelyAuthError: (error) => classifyTwitchApiFailure(error).kind === 'auth',
        onClearTwitchSessionCache: () => undefined,
        onRecoverTwitchSessionAfterAuthError: async () => {
          recoveryCalls += 1;
          return recovered ? session : null;
        },
        onStopFarmingSession: async () => {
          signInCalls += 1;
        },
      });

      if (recovered) expect(await pending).toHaveLength(0);
      else await expect(pending).rejects.toBeInstanceOf(TwitchDirectoryUnavailableError);
      expect(recoveryCalls).toBe(1);
      expect(signInCalls).toBe(recovered ? 0 : 1);
      expect(requests).toBe(recovered ? 2 : 1);
      expect(state.appState.manualQueueAuthorized).toBe(true);
    },
  );

  test('does not resync or block the session after Stop invalidates an auth failure', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    let current = true;
    let resolveRequest: (response: Response) => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    globalThis.fetch = () =>
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
        markStarted();
      });
    let recoveries = 0;
    const pending = fetchDirectoryStreamersFromApiWrapper(state, createGame(), false, '', {
      onEnsureTwitchSession: async () => createSession(),
      onIsLikelyAuthError: () => true,
      onClearTwitchSessionCache: () => {
        recoveries += 1;
      },
      isCurrent: () => current,
    });
    await started;
    current = false;
    resolveRequest(new Response('', { status: 401 }));

    await expect(pending).rejects.toBeInstanceOf(TwitchDirectoryUnavailableError);
    expect(recoveries).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('temporary failure during silent session recovery does not request sign-in', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    let signInCalls = 0;
    globalThis.fetch = async () => new Response('', { status: 401 });
    await acquireStreamerForSelectedGame(state, {
      onOpenStreamer: async () => {
        await fetchDirectoryStreamersFromApiWrapper(state, createGame(), false, '', {
          onEnsureTwitchSession: async () => createSession(),
          onIsLikelyAuthError: (error) => classifyTwitchApiFailure(error).kind === 'auth',
          onClearTwitchSessionCache: () => undefined,
          onRecoverTwitchSessionAfterAuthError: async () => {
            throw new TwitchHttpError('gql', 503);
          },
          onStopFarmingSession: async () => {
            signInCalls += 1;
          },
        });
        return true;
      },
    });
    expect(signInCalls).toBe(0);
    expect(state.appState.recoveryReason).toBe('twitch-network');
    expect(state.appState.isRunning).toBe(true);
  });
});
