import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createInitialState } from '../../src/shared/utils.ts';
import type { TwitchDrop } from '../../src/types/index.ts';
import {
  createMinimalState,
  createSession,
  type FetchMock,
  installFetchMock,
  restoreFetch,
} from '../api-operations-fixtures.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

let chromeMocks: ChromeMocks;

describe('fetchInventorySnapshotFromApi', () => {
  let originalFetch: FetchMock | undefined;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    chromeMocks.teardown();
  });

  test('treats inventory 403 as transient and schedules backoff', async () => {
    const { fetchInventorySnapshotFromApi } = await import('../../src/background/api-operations.ts');

    const state = createMinimalState();
    const session = createSession();
    const cachedDrops: TwitchDrop[] = [
      {
        id: 'drop-1',
        name: 'For Honor Drop',
        gameId: 'campaign-for-honor',
        gameName: 'For Honor',
        imageUrl: 'https://example.com/drop.png',
        progress: 50,
        currentMinutes: 120,
        claimed: false,
        campaignId: 'campaign-for-honor',
        requiredMinutes: 240,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
    ];

    originalFetch = installFetchMock([
      async () => {
        throw new Error('403 forbidden');
      },
    ]);

    expect(await fetchInventorySnapshotFromApi(state, session, cachedDrops)).toBeNull();
    expect(state.apiConsecutiveFailures).toBe(1);
    expect(state.apiBackoffUntil).toBeGreaterThan(Date.now());
  });

  test('wrapper stops running farming when inventory auth still fails after explicit session recovery', async () => {
    const { fetchInventorySnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');

    const session = createSession();
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    let ensureCalls = 0;
    let recoveryCalls = 0;
    let stopReason: string | undefined;
    const cachedDrops: TwitchDrop[] = [
      {
        id: 'drop-1',
        name: 'For Honor Drop',
        gameId: 'campaign-for-honor',
        gameName: 'For Honor',
        imageUrl: 'https://example.com/drop.png',
        progress: 50,
        currentMinutes: 120,
        claimed: false,
        campaignId: 'campaign-for-honor',
        requiredMinutes: 240,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      },
    ];

    originalFetch = installFetchMock([
      async () => {
        throw new Error('401 unauthorized');
      },
      async () => {
        throw new Error('invalid oauth token');
      },
    ]);

    const result = await fetchInventorySnapshotFromApiWrapper(
      state,
      cachedDrops,
      { sessionRecoveryMode: 'background-tab' },
      {
        onEnsureTwitchSession: async () => {
          ensureCalls += 1;
          return session;
        },
        onRecoverTwitchSessionAfterAuthError: async () => {
          recoveryCalls += 1;
          return session;
        },
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: (error) => /401|invalid oauth token/i.test(String(error)),
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      { logWarn: () => undefined },
    );

    expect(result).toBeNull();
    expect(ensureCalls).toBe(1);
    expect(recoveryCalls).toBe(1);
    expect(stopReason).toBe('sign-in-required');
  });

  test('keeps a missing inventory session transient after checking existing Twitch tabs', async () => {
    const { fetchInventorySnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: null,
    });
    let recoveryCalls = 0;
    let stopReason: string | undefined;

    const result = await fetchInventorySnapshotFromApiWrapper(
      state,
      [],
      { sessionRecoveryMode: 'background-tab' },
      {
        onEnsureTwitchSession: async () => null,
        onRecoverTwitchSessionAfterAuthError: async () => {
          recoveryCalls += 1;
          return null;
        },
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: () => false,
        onClearTwitchSessionCache: () => undefined,
      },
      { logWarn: () => undefined },
    );

    expect(result).toBeNull();
    expect(recoveryCalls).toBe(1);
    expect(stopReason).toBeUndefined();
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.twitchSessionSyncState.status).toBe('retrying');
  });
});
