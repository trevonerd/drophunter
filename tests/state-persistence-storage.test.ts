import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearPendingTimingStateSaveForTests,
  resetStateForInactivity,
  saveState,
} from '../src/background/state-persistence.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createAppState, createMinimalState } from './fixtures/state-persistence.ts';
import { createTwitchDrop } from './fixtures/twitch-drop.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

describe('saveState', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    clearPendingTimingStateSaveForTests();
    mocks.teardown();
  });

  test('persists appState and drops snapshot to local storage', async () => {
    const state = createMinimalState({
      appState: createAppState({ isRunning: true }),
      cachedDropsSnapshot: [createTwitchDrop({ id: 'drop1' }), createTwitchDrop({ id: 'drop2' })],
    });

    await saveState(state);

    expect(mocks.storage.local._store.get('appState')).toMatchObject({ isRunning: true });
    expect(mocks.storage.local._store.get('dropsSnapshotCache')).toEqual([
      createTwitchDrop({ id: 'drop1' }),
      createTwitchDrop({ id: 'drop2' }),
    ]);
  });

  test('calls broadcastStateUpdate after persisting', async () => {
    let badgeText = '';
    const originalSetBadgeText = mocks.action.setBadgeText;
    mocks.action.setBadgeText = (details) => {
      badgeText = details.text ?? '';
      originalSetBadgeText(details);
    };
    const state = createMinimalState({
      appState: createAppState({ isRunning: false }),
      cachedDropsSnapshot: [],
    });

    await saveState(state);

    expect(badgeText).toBe('');
  });
});

describe('resetStateForInactivity', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    clearPendingTimingStateSaveForTests();
    mocks.teardown();
  });

  test('preserves lifetime statistics while clearing volatile farming state', async () => {
    const state = createMinimalState({
      appState: createAppState({
        isRunning: true,
        selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
        totalDropsClaimed: 12,
        totalChannelPointsClaimed: 34,
        favoriteGames: [{ gameId: '509658', lastKnownName: 'Valorant', addedAt: 1 }],
        campaignPriorityMode: 'lowest-availability',
        farmCategoryScope: 'favorites-only',
        autoStartFavoriteGames: true,
      }),
      cachedDropsSnapshot: [createTwitchDrop({ id: 'drop1' })],
      dropClaimRetryAtById: new Map([['claim-1', Date.now() + 1000]]),
    });

    await resetStateForInactivity(
      state,
      'test',
      999,
      {
        onStopMonitoring: () => undefined,
        onClearRotationMetadata: (appState) => appState,
        onResetStreamTrackingState: () => undefined,
        onSaveTimingState: async () => undefined,
        onBroadcastStateUpdate: () => undefined,
      },
      {
        createInitialState,
        DROPS_SNAPSHOT_CACHE_KEY: 'dropsSnapshotCache',
        LAST_ACTIVITY_AT_KEY: 'lastActivityAt',
        TIMING_STATE_KEY: 'timingState',
      },
    );

    expect(state.appState).toMatchObject({
      isRunning: false,
      selectedGame: null,
      totalDropsClaimed: 12,
      totalChannelPointsClaimed: 34,
      favoriteGames: [{ gameId: '509658', lastKnownName: 'Valorant', addedAt: 1 }],
      campaignPriorityMode: 'lowest-availability',
      farmCategoryScope: 'favorites-only',
      autoStartFavoriteGames: true,
    });
    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      totalDropsClaimed: 12,
      totalChannelPointsClaimed: 34,
    });
  });

  test('removes stale timingState from local storage during inactivity reset even before timing save flushes', async () => {
    const staleTiming = {
      lastProgressAdvanceAt: 123456,
      recoveryBackoffUntil: Date.now() + 60_000,
      stalledRecoveryAttempts: 3,
      lastHeartbeatAt: 999999,
    };
    await mocks.chrome.storage.local.set({ timingState: staleTiming });
    await mocks.chrome.storage.session.set({ timingState: staleTiming });
    const state = createMinimalState({
      appState: createAppState({
        isRunning: true,
        activeStreamer: { id: 's1', name: 'streamer', displayName: 'Streamer', isLive: true },
        tabId: 321,
      }),
      lastProgressAdvanceAt: 123456,
      recoveryBackoffUntil: staleTiming.recoveryBackoffUntil,
      stalledRecoveryAttempts: 3,
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
      },
    });

    await resetStateForInactivity(
      state,
      'test',
      999,
      {
        onStopMonitoring: () => undefined,
        onClearRotationMetadata: (appState) => appState,
        onResetStreamTrackingState: () => {
          state.lastProgressAdvanceAt = 0;
          state.recoveryBackoffUntil = 0;
          state.stalledRecoveryAttempts = 0;
        },
        onSaveTimingState: async () => undefined,
        onBroadcastStateUpdate: () => undefined,
      },
      {
        createInitialState,
        DROPS_SNAPSHOT_CACHE_KEY: 'dropsSnapshotCache',
        LAST_ACTIVITY_AT_KEY: 'lastActivityAt',
        TIMING_STATE_KEY: 'timingState',
      },
    );

    expect(mocks.storage.local._store.has('timingState')).toBe(false);
    expect(mocks.storage.session._store.has('timingState')).toBe(false);
    expect(state.appState.tabId).toBeNull();
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.unverifiableRewardsByKey).toEqual({});
  });
});
