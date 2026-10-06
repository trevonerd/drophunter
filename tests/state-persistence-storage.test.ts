import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FARMING_RECOVERY_RETRY_ALARM_NAME } from '../src/background/farming-recovery-alarm.ts';
import {
  clearPendingTimingStateSaveForTests,
  resetStateForInactivity,
  saveState,
} from '../src/background/state-persistence.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createAppState, createMinimalState } from './fixtures/state-persistence.ts';
import { createTwitchDrop } from './fixtures/twitch-drop.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

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

  test('persists Twitch session retry state with the cached farming state', async () => {
    const state = createMinimalState({
      appState: createAppState({
        isRunning: true,
        twitchSessionSyncState: { status: 'retrying', attempts: 2, nextRetryAt: 123_456 },
      }),
    });

    await saveState(state);

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      isRunning: true,
      twitchSessionSyncState: { status: 'retrying', attempts: 2, nextRetryAt: 123_456 },
    });
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

  test('a staged save writes storage without publishing the candidate or changing the live recovery alarm', async () => {
    const messages: unknown[] = [];
    mocks.chrome.runtime.sendMessage = (message) => {
      messages.push(message);
      return Promise.resolve(undefined);
    };
    const incumbent = createMinimalState({
      appState: createAppState({
        isRunning: true,
        selectedGame: { id: 'smite', name: 'SMITE', imageUrl: '', campaignId: 'smite-campaign' },
        currentDrop: createTwitchDrop({ id: 'smite-drop', campaignId: 'smite-campaign', progress: 12 }),
        recoveryReason: 'stalled-progress',
        recoveryBackoffUntil: Date.now() + 60_000,
      }),
    });
    await saveState(incumbent);
    const liveAlarm = await mocks.chrome.alarms.get(FARMING_RECOVERY_RETRY_ALARM_NAME);
    const staged = {
      ...incumbent,
      appState: {
        ...incumbent.appState,
        selectedGame: { id: 'r6', name: 'R6', imageUrl: '', campaignId: 'r6-campaign' },
        currentDrop: createTwitchDrop({ id: 'r6-drop', campaignId: 'r6-campaign', progress: 67 }),
        recoveryReason: null,
        recoveryBackoffUntil: null,
      },
    };
    messages.length = 0;

    await saveState(staged, { deferPublicEffects: true });

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      selectedGame: { campaignId: 'r6-campaign' },
    });
    expect(messages).toEqual([]);
    expect(mocks.action.getBadgeState().text).toBe('12%');
    expect(await mocks.chrome.alarms.get(FARMING_RECOVERY_RETRY_ALARM_NAME)).toEqual(liveAlarm);

    await saveState(staged);

    expect(messages).toHaveLength(1);
    expect(mocks.action.getBadgeState().text).toBe('67%');
    expect(await mocks.chrome.alarms.get(FARMING_RECOVERY_RETRY_ALARM_NAME)).toBeUndefined();
  });

  test('a staged candidate shares the live persistence queue so older writes cannot overwrite its commit', async () => {
    const live = createMinimalState({
      appState: createAppState({
        selectedGame: { id: 'smite', name: 'SMITE', imageUrl: '', campaignId: 'smite-campaign' },
      }),
    });
    const candidate = {
      ...live,
      appState: {
        ...live.appState,
        selectedGame: { id: 'r6', name: 'R6', imageUrl: '', campaignId: 'r6-campaign' },
      },
    };
    const firstWrite = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const originalSet = mocks.chrome.storage.local.set;
    let writes = 0;
    mocks.chrome.storage.local.set = async (values) => {
      const captured = structuredClone(values);
      if (!('appState' in captured)) {
        await originalSet(captured);
        return;
      }
      writes += 1;
      if (writes === 1) {
        firstWrite.resolve();
        await releaseFirst.promise;
      }
      await originalSet(captured);
    };
    const olderSave = saveState(live);
    await firstWrite.promise;
    const candidateSave = saveState(candidate, { deferPublicEffects: true, transactionOwner: live });
    try {
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
      expect(writes).toBe(1);
    } finally {
      releaseFirst.resolve();
      await Promise.all([olderSave, candidateSave]);
    }
    expect(writes).toBe(2);
    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      selectedGame: { campaignId: 'r6-campaign' },
    });
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
      isRunning: true,
      selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
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
