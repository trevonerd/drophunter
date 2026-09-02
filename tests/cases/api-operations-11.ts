import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createInitialState } from '../../src/shared/utils.ts';
import {
  buildInventoryResponse,
  createMinimalState,
  createSession,
  type FetchMock,
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

  test('handles integrity errors by attempting retry logic', async () => {
    const { fetchDropsSnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession({ clientIntegrity: 'original-token' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: null, errors: [{ message: 'integrity error' }] }),
        text: async () => JSON.stringify({ data: null, errors: [{ message: 'integrity error' }] }),
      } as Response;
    };

    const result = await fetchDropsSnapshotFromApi(state, session);

    globalThis.fetch = originalFetch;

    expect(result).toBeNull();
    expect(state.apiConsecutiveFailures).toBeGreaterThan(0);
  });

  test('wrapper stops running farming when auth still fails after explicit session recovery', async () => {
    const { fetchDropsSnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');

    const session = createSession();
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    let ensureCalls = 0;
    let recoveryCalls = 0;
    let stopReason: string | undefined;

    let dashboardCalls = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body?.operationName === 'ViewerDropsDashboard') {
        dashboardCalls += 1;
        throw new Error(dashboardCalls === 1 ? '401 unauthorized' : 'invalid oauth token');
      }
      return {
        ok: true,
        status: 200,
        json: async () => buildInventoryResponse(),
        text: async () => JSON.stringify(buildInventoryResponse()),
      } as Response;
    }) as FetchMock;

    const result = await fetchDropsSnapshotFromApiWrapper(
      state,
      { sessionRecoveryMode: 'background-tab' },
      {
        onEnsureTwitchSession: async () => {
          ensureCalls += 1;
          return session;
        },
        onEnsureSessionIntegrity: async () => session,
        onRecoverTwitchSessionAfterAuthError: async () => {
          recoveryCalls += 1;
          return session;
        },
        onPersistTwitchSession: async () => undefined,
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: (error) => /401|invalid oauth token/i.test(String(error)),
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
    expect(ensureCalls).toBe(1);
    expect(recoveryCalls).toBe(1);
    expect(stopReason).toBe('sign-in-required');
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('does not stop farming when userId auto-detect fails transiently (network/timeout)', async () => {
    const { fetchDropsSnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');
    const { TwitchApiClient } = await import('../../src/background/twitch-api/client.ts');

    const session = createSession({ userId: '' });
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    let stopCalled = false;

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error('Twitch GQL request timed out.');
    }) as FetchMock;

    const result = await fetchDropsSnapshotFromApiWrapper(
      state,
      {},
      {
        onEnsureTwitchSession: async () => session,
        onEnsureSessionIntegrity: async () => session,
        onPersistTwitchSession: async () => undefined,
        onStopFarmingSession: async () => {
          stopCalled = true;
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
    expect(stopCalled).toBe(false);
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.apiBackoffUntil).toBeGreaterThan(0);
  });
});
