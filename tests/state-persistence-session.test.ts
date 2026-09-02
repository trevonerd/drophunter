import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearPendingTimingStateSaveForTests,
  loadState,
  markActivity,
  sessionDebugSummary,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createAppState, createMinimalState } from './fixtures/state-persistence.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

describe('sessionDebugSummary', () => {
  test('returns available:false for null session', () => {
    expect(sessionDebugSummary(null)).toEqual({ available: false });
  });

  test('returns available:true with all fields for valid session', () => {
    const session: TwitchSession = {
      userId: 'uid123',
      oauthToken: 'tokensecret',
      clientIntegrity: 'integrity-token',
      deviceId: 'device-abc-xyz-123456',
      uuid: 'uuid-abc',
      clientId: 'client-xyz',
    };

    expect(sessionDebugSummary(session)).toEqual({
      available: true,
      hasUserId: true,
      hasOAuthToken: true,
      hasIntegrity: true,
      hasDeviceId: true,
      hasUuid: true,
      hasClientId: true,
    });
  });

  test('handles missing optional fields', () => {
    const session: TwitchSession = { userId: 'uid1', oauthToken: '', deviceId: '', uuid: '' };
    const result = sessionDebugSummary(session);

    expect(result).toEqual({
      available: true,
      hasUserId: true,
      hasOAuthToken: false,
      hasIntegrity: false,
      hasDeviceId: false,
      hasUuid: false,
      hasClientId: false,
    });
  });
});

describe('markActivity', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
    setTimingSaveDebounceMsForTests(0);
  });

  afterEach(() => {
    clearPendingTimingStateSaveForTests();
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  });

  test('sets lastActivityAt on state and persists to storage', async () => {
    const state = createMinimalState({ lastActivityAt: 0 });
    const before = Date.now();
    await markActivity(state, 'test-reason');
    const after = Date.now();

    expect(state.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(state.lastActivityAt).toBeLessThanOrEqual(after);
    expect(mocks.storage.local._store.get('lastActivityAt')).toBe(state.lastActivityAt);
  });
});

describe('loadState', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
    setTimingSaveDebounceMsForTests(0);
  });

  afterEach(() => {
    clearPendingTimingStateSaveForTests();
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  });

  test('clears stale drops page refresh progress on service worker startup', async () => {
    await mocks.storage.local.set({
      appState: createAppState({ dropsPageRefreshInProgress: true }),
    });
    const state = createMinimalState();

    await loadState(
      state,
      {
        onLoadTimingState: async () => undefined,
        onEnforceInactivityReset: async () => false,
      },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary,
        createInitialState,
        clearRotationMetadata: (appState) => appState,
        TWITCH_SESSION_STORAGE_KEY: 'twitchSession',
        DROPS_SNAPSHOT_CACHE_KEY: 'dropsSnapshotCache',
        LAST_ACTIVITY_AT_KEY: 'lastActivityAt',
        TIMING_STATE_KEY: 'timingState',
        STREAM_VALIDATION_GRACE_MS: 0,
      },
    );

    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      dropsPageRefreshInProgress: false,
    });
  });

  test('loads and migrates legacy running auth recovery without losing its queue', async () => {
    const queued = { id: 'game-1', name: 'FragPunk', imageUrl: '', campaignId: 'campaign-1' };
    await mocks.storage.local.set({
      appState: {
        ...createAppState(),
        isRunning: true,
        selectedGame: null,
        queue: [queued],
        recoveryReason: 'sign-in-required',
        recoveryAttempts: 2,
        recoveryBackoffUntil: 123_456,
        twitchSessionSyncState: undefined,
      },
    });
    const state = createMinimalState();

    await loadState(
      state,
      {
        onLoadTimingState: async () => undefined,
        onEnforceInactivityReset: async () => false,
      },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary,
        createInitialState,
        clearRotationMetadata: (appState) => appState,
        TWITCH_SESSION_STORAGE_KEY: 'twitchSession',
        DROPS_SNAPSHOT_CACHE_KEY: 'dropsSnapshotCache',
        LAST_ACTIVITY_AT_KEY: 'lastActivityAt',
        TIMING_STATE_KEY: 'timingState',
        STREAM_VALIDATION_GRACE_MS: 0,
      },
    );

    expect(state.appState.selectedGame).toEqual(queued);
    expect(state.appState.queue).toEqual([queued]);
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.appState.twitchSessionSyncState).toEqual({
      status: 'retrying',
      attempts: 2,
      nextRetryAt: 123_456,
    });
  });
});
