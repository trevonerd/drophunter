import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { setupChromeMocks } from './mocks/chrome.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import {
  sessionDebugSummary,
  markActivity,
  loadTimingState,
  saveTimingState,
  shouldRefreshGamesCache,
  broadcastStateUpdate,
  saveState,
  resetStateForInactivity,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import type { AppState } from '../src/types/index.ts';
import type { TwitchSession } from '../src/background/twitch-api/types.ts';

function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryAtById: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

function createAppState(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialState(), ...overrides };
}

describe('sessionDebugSummary', () => {
  test('returns available:false for null session', () => {
    const result = sessionDebugSummary(null);
    expect(result).toEqual({ available: false });
  });

  test('returns available:true with all fields for valid session', () => {
    const session: TwitchSession = {
      userId: 'uid123',
      oauthToken: 'tokensecret',
      clientIntegrity: true,
      deviceId: 'device-abc-xyz-123456',
      uuid: 'uuid-abc',
      clientId: 'client-xyz',
    };
    const result = sessionDebugSummary(session);
    expect(result).toEqual({
      available: true,
      userId: 'uid123',
      oauthTokenLength: 11,
      hasIntegrity: true,
      deviceIdSuffix: '123456',
      uuid: 'uuid-abc',
      clientId: 'client-xyz',
    });
  });

  test('handles missing optional fields', () => {
    const session = { userId: 'uid1' } as TwitchSession;
    const result = sessionDebugSummary(session);
    expect(result.available).toBe(true);
    expect(result.userId).toBe('uid1');
    expect(result.oauthTokenLength).toBe(0);
    expect(result.hasIntegrity).toBe(false);
    expect(result.deviceIdSuffix).toBeNull();
    expect(result.uuid).toBeNull();
    expect(result.clientId).toBeNull();
  });
});

describe('markActivity', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
    setTimingSaveDebounceMsForTests(0);
  });

  afterEach(() => {
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

describe('loadTimingState / saveTimingState', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

    test('saveTimingState persists timing to local storage', async () => {
    const state = createMinimalState({
      lastStreamRotationAt: 1000,
      streamValidationGraceUntil: 2000,
      invalidStreamChecks: 3,
      noProgressRotationAttempts: 5,
      twitchSessionLastAttemptAt: 3000,
      lastProgressAdvanceAt: 4000,
      lastTrackedProgress: 42,
      lastTrackedMinutes: 10,
      lastTrackedDropKey: 'drop-key-123',
      apiConsecutiveFailures: 2,
      apiBackoffUntil: 5000,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: 6000,
      recoveryBackoffUntil: 7000,
      lastRecoveryAttemptAt: 8000,
      stalledRecoveryAttempts: 1,
      recoveryNotificationSent: true,
      dropClaimRetryAtById: new Map([['drop1', 999]]),
    });

    await saveTimingState(state);

    const saved = mocks.storage.local._store.get('timingState') as Record<string, unknown>;
    expect(saved.lastStreamRotationAt).toBe(1000);
    expect(saved.streamValidationGraceUntil).toBe(2000);
    expect(saved.invalidStreamChecks).toBe(3);
    expect(saved.noProgressRotationAttempts).toBe(5);
    expect(saved.twitchSessionLastAttemptAt).toBe(3000);
    expect(saved.lastProgressAdvanceAt).toBe(4000);
    expect(saved.lastTrackedProgress).toBe(42);
    expect(saved.lastTrackedMinutes).toBe(10);
    expect(saved.lastTrackedDropKey).toBe('drop-key-123');
    expect(saved.apiConsecutiveFailures).toBe(2);
    expect(saved.apiBackoffUntil).toBe(5000);
    expect(saved.integrityFallbackActive).toBe(true);
    expect(saved.integrityFallbackActiveUntil).toBe(6000);
    expect(saved.recoveryBackoffUntil).toBe(7000);
    expect(saved.lastRecoveryAttemptAt).toBe(8000);
    expect(saved.stalledRecoveryAttempts).toBe(1);
    expect(saved.recoveryNotificationSent).toBe(true);
    expect((saved.dropClaimRetryAtById as Record<string, number>)).toEqual({ drop1: 999 });
  });

  test('loadTimingState restores timing from local storage', async () => {
    const state = createMinimalState();
    const futureTime = Date.now() + 999999;
    mocks.storage.local._store.set('timingState', {
      lastStreamRotationAt: 1111,
      streamValidationGraceUntil: 2222,
      invalidStreamChecks: 7,
      noProgressRotationAttempts: 9,
      twitchSessionLastAttemptAt: 3333,
      dropClaimRetryAtById: { dropA: 4444, dropB: 5555 },
      lastProgressAdvanceAt: 6666,
      lastTrackedProgress: 88,
      lastTrackedMinutes: 44,
      lastTrackedDropKey: 'key-loaded',
      apiConsecutiveFailures: 4,
      apiBackoffUntil: 7777,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: futureTime,
      recoveryBackoffUntil: futureTime,
      lastRecoveryAttemptAt: 101010,
      stalledRecoveryAttempts: 2,
      recoveryNotificationSent: false,
    });

    await loadTimingState(state);

    expect(state.lastStreamRotationAt).toBe(1111);
    expect(state.streamValidationGraceUntil).toBe(2222);
    expect(state.invalidStreamChecks).toBe(7);
    expect(state.noProgressRotationAttempts).toBe(9);
    expect(state.twitchSessionLastAttemptAt).toBe(3333);
    expect(state.dropClaimRetryAtById.get('dropA')).toBe(4444);
    expect(state.dropClaimRetryAtById.get('dropB')).toBe(5555);
    expect(state.lastProgressAdvanceAt).toBe(6666);
    expect(state.lastTrackedProgress).toBe(88);
    expect(state.lastTrackedMinutes).toBe(44);
    expect(state.lastTrackedDropKey).toBe('key-loaded');
    expect(state.apiConsecutiveFailures).toBe(4);
    expect(state.apiBackoffUntil).toBe(7777);
    expect(state.integrityFallbackActive).toBe(true);
    expect(state.integrityFallbackActiveUntil).toBe(futureTime);
    expect(state.recoveryBackoffUntil).toBe(futureTime);
    expect(state.lastRecoveryAttemptAt).toBe(101010);
    expect(state.stalledRecoveryAttempts).toBe(2);
    expect(state.recoveryNotificationSent).toBe(false);
  });

  test('loadTimingState clears and repopulates dropClaimRetryAtById', async () => {
    const state = createMinimalState({
      dropClaimRetryAtById: new Map([['existing', 111]]),
    });
    mocks.storage.local._store.set('timingState', {
      dropClaimRetryAtById: { new1: 222, new2: 333 },
    });

    await loadTimingState(state);

    expect(state.dropClaimRetryAtById.has('existing')).toBe(false);
    expect(state.dropClaimRetryAtById.get('new1')).toBe(222);
    expect(state.dropClaimRetryAtById.get('new2')).toBe(333);
  });

  test('round-trip: save then load preserves timing state', async () => {
    const original = createMinimalState({
      lastStreamRotationAt: 12345,
      streamValidationGraceUntil: 23456,
      invalidStreamChecks: 6,
      noProgressRotationAttempts: 12,
      twitchSessionLastAttemptAt: 34567,
      lastProgressAdvanceAt: 45678,
      lastTrackedProgress: 77,
      lastTrackedMinutes: 55,
      lastTrackedDropKey: 'round-trip-key',
      apiConsecutiveFailures: 5,
      apiBackoffUntil: 56789,
      integrityFallbackActive: true,
      integrityFallbackActiveUntil: Date.now() + 86400000,
      recoveryBackoffUntil: Date.now() + 86400000,
      lastRecoveryAttemptAt: 89012,
      stalledRecoveryAttempts: 3,
      recoveryNotificationSent: true,
      dropClaimRetryAtById: new Map([['dropX', 98765]]),
    });

    await saveTimingState(original);
    const restored = createMinimalState();
    await loadTimingState(restored);

    expect(restored.lastStreamRotationAt).toBe(original.lastStreamRotationAt);
    expect(restored.streamValidationGraceUntil).toBe(original.streamValidationGraceUntil);
    expect(restored.invalidStreamChecks).toBe(original.invalidStreamChecks);
    expect(restored.noProgressRotationAttempts).toBe(original.noProgressRotationAttempts);
    expect(restored.twitchSessionLastAttemptAt).toBe(original.twitchSessionLastAttemptAt);
    expect(restored.lastProgressAdvanceAt).toBe(original.lastProgressAdvanceAt);
    expect(restored.lastTrackedProgress).toBe(original.lastTrackedProgress);
    expect(restored.lastTrackedMinutes).toBe(original.lastTrackedMinutes);
    expect(restored.lastTrackedDropKey).toBe(original.lastTrackedDropKey);
    expect(restored.apiConsecutiveFailures).toBe(original.apiConsecutiveFailures);
    expect(restored.apiBackoffUntil).toBe(original.apiBackoffUntil);
    expect(restored.integrityFallbackActive).toBe(original.integrityFallbackActive);
    expect(restored.integrityFallbackActiveUntil).toBe(original.integrityFallbackActiveUntil);
    expect(restored.recoveryBackoffUntil).toBe(original.recoveryBackoffUntil);
    expect(restored.lastRecoveryAttemptAt).toBe(original.lastRecoveryAttemptAt);
    expect(restored.stalledRecoveryAttempts).toBe(original.stalledRecoveryAttempts);
    expect(restored.recoveryNotificationSent).toBe(original.recoveryNotificationSent);
    expect(restored.dropClaimRetryAtById.get('dropX')).toBe(98765);
  });
});

describe('shouldRefreshGamesCache', () => {
  test('returns true when force=true', () => {
    const state = createMinimalState({ lastGamesCacheRefreshAt: Date.now() });
    expect(shouldRefreshGamesCache(state, true)).toBe(true);
  });

  test('returns true when cache is stale', () => {
    const state = createMinimalState({ lastGamesCacheRefreshAt: 0 });
    expect(shouldRefreshGamesCache(state, false)).toBe(true);
  });

  test('returns false when cache is still fresh (GAMES_CACHE_TTL_MS = 5 min)', () => {
    const state = createMinimalState({ lastGamesCacheRefreshAt: Date.now() });
    expect(shouldRefreshGamesCache(state, false)).toBe(false);
  });
});

describe('broadcastStateUpdate', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('sets badge with progress percent when currentDrop present and running', async () => {
    const appState = createAppState({
      isRunning: true,
      currentDrop: { id: 'd1', progress: 55 } as any,
    });
    broadcastStateUpdate(appState);
    expect(mocks.action.getBadgeState().text).toBe('55%');
  });

  test('sets badge with ... when running but no currentDrop', async () => {
    const appState = createAppState({ isRunning: true, currentDrop: null });
    broadcastStateUpdate(appState);
    expect(mocks.action.getBadgeState().text).toBe('...');
  });

  test('clears badge when not running', async () => {
    const appState = createAppState({ isRunning: false });
    broadcastStateUpdate(appState);
    expect(mocks.action.getBadgeState().text).toBe('');
  });

  test('clears badge when isPaused even if isRunning is true', () => {
    const appState = createAppState({ isRunning: true, isPaused: true });
    broadcastStateUpdate(appState);
    expect(mocks.action.getBadgeState().text).toBe('...');
  });

  test('sends UPDATE_STATE message via chrome.runtime.sendMessage', () => {
    const appState = createAppState({ isRunning: false });
    let captured: unknown = null;
    const mockChrome = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const runtime = mockChrome?.runtime as Record<string, unknown> | undefined;
    const originalFn = runtime?.sendMessage as ((msg: unknown) => Promise<unknown>) | undefined;
    if (originalFn) {
      (runtime as Record<string, unknown>).sendMessage = (msg: unknown) => {
        captured = msg;
        return Promise.resolve();
      };
    }

    broadcastStateUpdate(appState);

    expect(captured).toEqual({ type: 'UPDATE_STATE', payload: appState });

    if (originalFn) {
      (runtime as Record<string, unknown>).sendMessage = originalFn;
    }
  });

  test('sets badge background color to #9146FF', () => {
    const appState = createAppState({ isRunning: true, currentDrop: { id: 'd1', progress: 10 } as any });
    broadcastStateUpdate(appState);
    expect(mocks.action.getBadgeState().color).toBe('#9146FF');
  });
});

describe('saveState', () => {
  let mocks: ChromeMocks;

  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('persists appState and drops snapshot to local storage', async () => {
    const state = createMinimalState({
      appState: createAppState({ isRunning: true }),
      cachedDropsSnapshot: [{ id: 'drop1' } as any, { id: 'drop2' } as any],
    });
    await saveState(state);

    const stored = mocks.storage.local._store;
    expect((stored.get('appState') as AppState).isRunning).toBe(true);
    expect((stored.get('dropsSnapshotCache') as any[])).toHaveLength(2);
  });

  test('calls broadcastStateUpdate after persisting', async () => {
    let badgeText = '';
    const origSetBadgeText = mocks.action.setBadgeText.bind(mocks.action);
    mocks.action.setBadgeText = (details) => {
      badgeText = details.text ?? '';
      origSetBadgeText(details);
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
    mocks.teardown();
  });

  test('preserves lifetime statistics while clearing volatile farming state', async () => {
    const state = createMinimalState({
      appState: createAppState({
        isRunning: true,
        selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
        totalDropsClaimed: 12,
        totalChannelPointsClaimed: 34,
      }),
      cachedDropsSnapshot: [{ id: 'drop1' } as any],
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

    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.selectedGame).toBeNull();
    expect(state.appState.totalDropsClaimed).toBe(12);
    expect(state.appState.totalChannelPointsClaimed).toBe(34);
    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      totalDropsClaimed: 12,
      totalChannelPointsClaimed: 34,
    });
  });
});
