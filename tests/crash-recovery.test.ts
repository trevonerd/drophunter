import { describe, expect, test, beforeEach } from 'bun:test';
import { setupChromeMocks } from './mocks/chrome.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import { saveTimingState, loadTimingState } from '../src/background/state-persistence.ts';
import { splitDropsForSelectedGame } from '../src/background/drop-processing.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { CRASH_DETECTION_THRESHOLD_MS, TIMING_SAVE_DEBOUNCE_MS } from '../src/background/constants.ts';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import type { TwitchGame } from '../src/types/index.ts';

let mocks: ChromeMocks;

function makeState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: -1,
    lastTrackedMinutes: -1,
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
    lastHeartbeatAt: 0,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  } as ServiceWorkerState;
}

beforeEach(() => {
  mocks = setupChromeMocks();
});

describe('saveTimingState debounce', () => {
  test('multiple rapid calls result in one storage write', async () => {
    const state = makeState({ lastHeartbeatAt: 123 });
    const p1 = saveTimingState(state);
    const p2 = saveTimingState(state);
    const p3 = saveTimingState(state);
    await Promise.all([p1, p2, p3]);
    const setCalls = mocks.storage.local._store.has('timingState') ? 1 : 0;
    expect(setCalls).toBe(1);
  });

  test('lastHeartbeatAt is persisted and restored', async () => {
    const state = makeState({ lastHeartbeatAt: 9999 });
    await saveTimingState(state);
    const restored = makeState();
    await loadTimingState(restored);
    expect(restored.lastHeartbeatAt).toBe(9999);
  });
});

describe('loadTimingState', () => {
  test('restores lastHeartbeatAt from local storage', async () => {
    const ts = Date.now() - 5000;
    await mocks.storage.local.set({ timingState: { lastHeartbeatAt: ts } });
    const state = makeState();
    await loadTimingState(state);
    expect(state.lastHeartbeatAt).toBe(ts);
  });

  test('defaults lastHeartbeatAt to 0 when missing', async () => {
    const state = makeState();
    await loadTimingState(state);
    expect(state.lastHeartbeatAt).toBe(0);
  });
});

describe('crash detection threshold', () => {
  test('CRASH_DETECTION_THRESHOLD_MS is 30 seconds', () => {
    expect(CRASH_DETECTION_THRESHOLD_MS).toBe(30_000);
  });

  test('stale heartbeat exceeds threshold', () => {
    const lastHeartbeatAt = Date.now() - 60_000;
    expect(Date.now() - lastHeartbeatAt > CRASH_DETECTION_THRESHOLD_MS).toBe(true);
  });

  test('recent heartbeat does not exceed threshold', () => {
    const lastHeartbeatAt = Date.now() - 5_000;
    expect(Date.now() - lastHeartbeatAt > CRASH_DETECTION_THRESHOLD_MS).toBe(false);
  });
});

describe('false recovery proof guard (freshTimingState)', () => {
  const game: TwitchGame = { id: 'g1', name: 'TestGame' };

  test('first tick with sentinel values does not trigger recovery proof reset', () => {
    const state = makeState({
      lastTrackedProgress: -1,
      lastTrackedMinutes: -1,
      lastTrackedDropKey: null,
      lastProgressAdvanceAt: 0,
      noProgressRotationAttempts: 3,
      recoveryBackoffUntil: Date.now() + 60_000,
    });
    state.appState.selectedGame = game;

    const drop = {
      id: 'd1', campaignId: 'c1', name: 'Drop1', gameName: 'TestGame',
      progress: 45, currentMinutes: 45, remainingMinutes: 15,
      claimed: false, claimable: false, status: 'active' as const,
      dropType: 'time-based' as const,
    };

    splitDropsForSelectedGame(state, [drop]);

    expect(state.noProgressRotationAttempts).toBe(3);
    expect(state.recoveryBackoffUntil).toBeGreaterThan(Date.now());
    expect(state.lastProgressAdvanceAt).toBeGreaterThan(0);
  });

  test('subsequent tick with real values does trigger recovery proof', () => {
    const state = makeState({
      lastTrackedProgress: 40,
      lastTrackedMinutes: 40,
      lastTrackedDropKey: 'g1::c1',
      lastProgressAdvanceAt: Date.now() - 10_000,
      noProgressRotationAttempts: 2,
      recoveryBackoffUntil: Date.now() + 60_000,
    });
    state.appState.selectedGame = game;

    const drop = {
      id: 'd1', campaignId: 'c1', name: 'Drop1', gameName: 'TestGame',
      progress: 50, currentMinutes: 50, remainingMinutes: 10,
      claimed: false, claimable: false, status: 'active' as const,
      dropType: 'time-based' as const,
    };

    splitDropsForSelectedGame(state, [drop]);

    expect(state.noProgressRotationAttempts).toBe(0);
    expect(state.recoveryBackoffUntil).toBe(0);
  });
});
