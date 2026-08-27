import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createInitialState } from '../../src/shared/utils.ts';
import {
  buildDropsDashboardResponse,
  buildInventoryResponse,
  createMinimalState,
  createSession,
  type FetchMock,
  installFetchMock,
  restoreFetch,
} from '../api-operations-fixtures.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

let chromeMocks: ChromeMocks;

describe('fetchDropsSnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('uses explicit auth recovery when userId auto-detect receives an OAuth error', async () => {
    const { fetchDropsSnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');

    const invalidSession = createSession({ userId: '' });
    const recoveredSession = createSession({
      oauthToken: 'recovered-token-at-least-20-chars',
      userId: '987654321',
    });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: invalidSession,
    });
    let recoveryCalls = 0;
    let stopCalled = false;
    originalFetch = installFetchMock([
      async () => {
        throw new Error('401 invalid oauth token');
      },
      async () => buildDropsDashboardResponse([]),
      async () => buildInventoryResponse(),
    ]);

    const result = await fetchDropsSnapshotFromApiWrapper(
      state,
      false,
      {
        onEnsureTwitchSession: async () => invalidSession,
        onEnsureSessionIntegrity: async (_state, session) => session,
        onRecoverTwitchSessionAfterAuthError: async () => {
          recoveryCalls += 1;
          return recoveredSession;
        },
        onPersistTwitchSession: async () => undefined,
        onStopFarmingSession: async () => {
          stopCalled = true;
        },
        onIsLikelyAuthError: (error) => /401|invalid oauth token/i.test(String(error)),
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      {
        TwitchApiClient,
        sessionDebugSummary: (session) => ({ available: Boolean(session) }),
        PROGRESS_POLL_MS: 60_000,
        logDebug: () => undefined,
        logWarn: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(result).not.toBeNull();
    expect(recoveryCalls).toBe(1);
    expect(stopCalled).toBe(false);
  });

  test('still stops farming when auto-detect completes but finds no userId', async () => {
    const { fetchDropsSnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');

    const session = createSession({ userId: '' });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    let stopReason: string | undefined;

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { currentUser: null } }),
        text: async () => JSON.stringify({ data: { currentUser: null } }),
      } as Response;
    }) as FetchMock;

    const result = await fetchDropsSnapshotFromApiWrapper(
      state,
      false,
      {
        onEnsureTwitchSession: async () => session,
        onEnsureSessionIntegrity: async () => session,
        onPersistTwitchSession: async () => undefined,
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: () => false,
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      {
        TwitchApiClient,
        sessionDebugSummary: (nextSession) => ({ available: Boolean(nextSession) }),
        PROGRESS_POLL_MS: 60_000,
        logDebug: () => undefined,
        logWarn: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(result).toBeNull();
    expect(stopReason).toBe('sign-in-required');
  });

  test('clears a stale sign-in-required stop once a drops snapshot fetch succeeds', async () => {
    const { fetchDropsSnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');

    const session = createSession();
    const state = createMinimalState({
      appState: {
        ...createInitialState(),
        isRunning: false,
        lastStopReason: 'sign-in-required',
        lastStopMessage: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
      },
      twitchSessionCache: session,
    });

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => buildInventoryResponse(),
        text: async () => JSON.stringify(buildInventoryResponse()),
      } as Response;
    }) as FetchMock;

    const result = await fetchDropsSnapshotFromApiWrapper(
      state,
      false,
      {
        onEnsureTwitchSession: async () => session,
        onEnsureSessionIntegrity: async () => session,
        onPersistTwitchSession: async () => undefined,
        onStopFarmingSession: async () => undefined,
        onIsLikelyAuthError: () => false,
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      {
        TwitchApiClient,
        sessionDebugSummary: (nextSession) => ({ available: Boolean(nextSession) }),
        PROGRESS_POLL_MS: 60_000,
        logDebug: () => undefined,
        logWarn: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(result).not.toBeNull();
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.appState.lastStopMessage).toBeNull();
  });
});
