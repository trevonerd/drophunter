import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createServiceWorkerTwitchGateway } from '../../src/background/service-worker-twitch-gateway.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

type FarmingSessionAdapters = Parameters<typeof createFarmingSession>[1];

const game: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game',
  rewardSummary: { completion: 'farmable', remainderReasons: [] },
};

const streamer: TwitchStreamer = {
  id: 'channel-1',
  name: 'channel-1',
  displayName: 'Channel 1',
  isLive: true,
};

const drop: TwitchDrop = {
  id: 'drop-1',
  name: 'Reward',
  gameId: game.id,
  gameName: game.name,
  imageUrl: '',
  progress: 10,
  currentMinutes: 1,
  claimed: false,
  campaignId: game.campaignId,
  status: 'active',
  requiredMinutes: 10,
  remainingMinutes: 9,
  acquisitionMethod: 'watch-time',
  rewardKind: 'unknown',
  verificationState: 'unassessed',
};

const twitchSession: TwitchSession = {
  oauthToken: 'expired-token',
  userId: 'viewer-1',
  deviceId: 'device-1',
  uuid: 'uuid-1',
};

function createState() {
  const state = createServiceWorkerState();
  state.appState.availableGames = [game];
  state.appState.queue = [game];
  state.appState.selectedGame = game;
  state.appState.activeStreamer = streamer;
  state.appState.currentDrop = drop;
  state.appState.pendingDrops = [drop];
  state.appState.allDrops = [drop];
  state.appState.isRunning = true;
  state.cachedDropsSnapshot = [drop];
  state.twitchSessionCache = twitchSession;
  return state;
}

function healthyWatch(): WatchHealth {
  return {
    mode: 'managed-tab',
    isHealthy: true,
    status: 'healthy',
    reason: 'heartbeat',
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress: 1,
    shouldFallback: false,
    checkedAt: Date.now(),
  };
}

function createAdapters(overrides: Partial<FarmingSessionAdapters> = {}): FarmingSessionAdapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => twitchSession,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () => Object.assign([streamer], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => game.categorySlug ?? null,
    openForegroundChannel: async () => {},
    enforcePlaybackPolicyOnStreamTab: async () => {},
    attemptPlaybackSelfHeal: async () => {},
    attemptAutoClaimChannelPointsBonus: async () => false,
    closeManagedTabIfSafe: async () => true,
    clearManagedTabOwnership: () => {},
    openMonitorDashboardWindow: async () => {},
    sendAlert: async () => {},
    notify: async () => {},
    saveState: async () => {},
    saveTimingState: async () => {},
    broadcastStateUpdate: () => {},
    monitorAutoOpenDelayMs: 0,
    ...overrides,
  };
}

describe('AFK Twitch authentication recovery', () => {
  let chromeMocks: ChromeMocks;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    chromeMocks = setupChromeMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    chromeMocks.teardown();
  });

  test('does not create a Drops tab after a confirmed OAuth failure', async () => {
    const state = createState();
    state.twitchSessionCache = { ...twitchSession, clientIntegrity: 'existing-integrity-token' };
    let createCalls = 0;
    let recoveryRequests = 0;
    chromeMocks.chrome.tabs.query = async (queryInfo) =>
      'windowId' in queryInfo ? [{ id: 999 }, { id: 1000 }] : [];
    chromeMocks.chrome.tabs.create = async () => {
      createCalls += 1;
      return { id: 999, windowId: 1, status: 'complete' };
    };

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        throw new Error('401 invalid oauth token');
      }
      return new Response(
        JSON.stringify({
          data: {
            currentUser: {
              inventory: { dropCampaignsInProgress: [], gameEventDrops: [] },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const gateway = createServiceWorkerTwitchGateway(state, {
      recoverTwitchSession: async () => {
        recoveryRequests += 1;
      },
    });

    await gateway.fetchInventorySnapshot([drop]);

    expect(createCalls).toBe(0);
    expect(state.twitchSessionCache).toBeNull();
    expect(fetchCalls).toBe(1);
    expect(recoveryRequests).toBe(1);
    expect(state.appState.isRunning).toBe(true);
  });

  test('ticks the watch transport while API refresh is backing off', async () => {
    const state = createState();
    state.apiBackoffUntil = Date.now() + 60_000;
    let transportTicks = 0;
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        watchTransport: {
          start: async () => healthyWatch(),
          tick: async () => {
            transportTicks += 1;
            return healthyWatch();
          },
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    await farmingSession.checkDropProgress();

    expect(transportTicks).toBe(1);
  });

  test('resumes a terminal authentication stop without another user start', async () => {
    const state = createState();
    state.appState.isRunning = false;
    state.appState.activeStreamer = null;
    state.appState.lastStopReason = 'sign-in-required';
    state.appState.lastStopMessage = 'Reconnect Twitch.';
    let transportStarts = 0;
    const farmingSession = createFarmingSession(
      state,
      createAdapters({
        watchTransport: {
          start: async () => {
            transportStarts += 1;
            state.appState.activeStreamer = streamer;
            return healthyWatch();
          },
          tick: async () => healthyWatch(),
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );

    await farmingSession.resumeAfterAuthRecovery();

    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.lastStopReason).toBeNull();
    expect(state.appState.activeStreamer).toEqual(streamer);
    expect(transportStarts).toBe(1);
  });
});
