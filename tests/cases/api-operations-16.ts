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

  test('rethrows inventory auth errors so wrappers can refresh the Twitch session', async () => {
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

    await expect(fetchInventorySnapshotFromApi(state, session, cachedDrops)).rejects.toThrow('403 forbidden');
    expect(state.apiConsecutiveFailures).toBe(0);
    expect(state.apiBackoffUntil).toBe(0);
  });

  test('wrapper stops running farming when inventory auth still fails after explicit session recovery', async () => {
    const { fetchInventorySnapshotFromApiWrapper } = await import('../../src/background/api-operations.ts');

    const session = createSession();
    const state = createMinimalState({
      appState: { ...createInitialState(), isRunning: true },
      twitchSessionCache: session,
    });
    const ensureCalls: boolean[] = [];
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
        throw new Error('403 forbidden');
      },
      async () => {
        throw new Error('invalid oauth token');
      },
    ]);

    const result = await fetchInventorySnapshotFromApiWrapper(
      state,
      cachedDrops,
      false,
      {
        onEnsureTwitchSession: async (forceRefresh = false) => {
          ensureCalls.push(forceRefresh);
          return session;
        },
        onRecoverTwitchSessionAfterAuthError: async () => {
          recoveryCalls += 1;
          return session;
        },
        onStopFarmingSession: async (options) => {
          stopReason = options.stopReason;
        },
        onIsLikelyAuthError: (error) => /403|invalid oauth token/i.test(String(error)),
        onClearTwitchSessionCache: (nextState) => {
          nextState.twitchSessionCache = null;
        },
      },
      { logWarn: () => undefined },
    );

    expect(result).toBeNull();
    expect(ensureCalls).toEqual([false]);
    expect(recoveryCalls).toBe(1);
    expect(stopReason).toBe('sign-in-required');
  });
});
