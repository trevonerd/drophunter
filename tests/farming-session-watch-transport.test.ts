import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { WatchHealth } from '../src/background/watch-transport.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { createFarmingSessionManualWatchFixture } from './support/farming-session-manual-watch.ts';

let chromeMocks: ChromeMocks;

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

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

function fixtureDrop(game: TwitchGame): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Reward',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    progress: 10,
    currentMinutes: 1,
    claimed: false,
    claimable: false,
    campaignId: game.campaignId,
    status: 'active',
    requiredMinutes: 10,
    remainingMinutes: 9,
    acquisitionMethod: 'watch-time',
    rewardKind: 'unknown',
    verificationState: 'unassessed',
  };
}

function createState() {
  const state = createServiceWorkerState();
  const drop = fixtureDrop(game);
  state.appState.availableGames = [game];
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.appState.currentDrop = drop;
  state.cachedDropsSnapshot = [drop];
  return state;
}

function createHealth(mode: WatchHealth['mode']): WatchHealth {
  return {
    mode,
    isHealthy: true,
    status: 'healthy',
    reason: 'started',
    consecutiveFailures: 0,
    consecutiveStalls: 0,
    progress: 1,
    shouldFallback: false,
    checkedAt: 1,
  };
}

function createAdapters(overrides: Partial<FarmingSessionAdapters> = {}): FarmingSessionAdapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () => Object.assign([streamer], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => 'game',
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

describe('farming session watch transport integration', () => {
  test('start, tick, and stop delegate to the configured transport', async () => {
    const state = createState();
    state.appState.watchTransportPreference = 'tabless';
    let starts = 0;
    let ticks = 0;
    let stops = 0;
    const health = createHealth('tabless');
    const watchTransport = {
      start: async () => {
        starts += 1;
        return health;
      },
      tick: async () => {
        ticks += 1;
        return health;
      },
      stop: async () => {
        stops += 1;
      },
      setPreference: async () => {},
    };
    const session = createFarmingSession(state, createAdapters({ watchTransport }));

    const started = await session.handleStartFarming({ game });
    await session.checkDropProgress();
    await session.handleStopFarming();

    expect(started.success).toBe(true);
    expect(starts).toBe(1);
    expect(ticks).toBe(1);
    expect(stops).toBe(1);
  });

  test('suspends, preserves suspension on observation failure, and resumes after playback ends', async () => {
    const state = createState();
    state.appState.selectedGame = game;
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.tabId = 7;
    let manualPlayback = true;
    let observationFails = false;
    let starts = 0;
    let ticks = 0;
    let stops = 0;
    let refreshes = 0;
    const health = createHealth('managed-tab');
    const watchTransport = {
      start: async () => {
        starts += 1;
        state.appState.tabId = 7;
        return health;
      },
      tick: async () => {
        ticks += 1;
        return health;
      },
      stop: async () => {
        stops += 1;
        state.appState.tabId = null;
      },
      setPreference: async () => {},
    };
    chromeMocks.tabs.setTabsQueryResult([{ id: 4, active: true, url: 'https://www.twitch.tv/manual' }]);
    chromeMocks.tabs.setTabsGetResult({ id: 7, url: 'https://www.twitch.tv/channel-1' });
    const manualWatchController = createFarmingSessionManualWatchFixture(state, async () => {
      if (observationFails) return { kind: 'failed' };
      return {
        kind: 'observed',
        tabs: manualPlayback
          ? [
              {
                tab: { id: 4, active: true, url: 'https://www.twitch.tv/manual' },
                context: {
                  channelName: 'manual',
                  categorySlug: 'game',
                  isLive: true,
                  isPlaybackReady: true,
                  hasDropsEnabled: true,
                },
              },
            ]
          : [],
      };
    });
    const session = createFarmingSession(
      state,
      createAdapters({
        fetchDropsSnapshotFromApi: async () => {
          refreshes += 1;
          return null;
        },
        fetchInventorySnapshotFromApi: async () => {
          refreshes += 1;
          return null;
        },
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([streamer], { languageFilterApplied: true }),
        fetchStreamContext: async () => {
          if (observationFails) {
            throw new DOMException('Injected observation failure', 'ObservationError');
          }
          return manualPlayback
            ? {
                channelName: 'manual',
                categorySlug: 'game',
                categoryLabel: 'Game',
                streamTitle: 'Drops enabled',
                titleContainsDrops: true,
                hasDropsSignal: true,
                isLive: true,
                videoCount: 1,
                playingVideoCount: 1,
                isPlaybackReady: true,
                pageUrl: 'https://www.twitch.tv/manual',
              }
            : null;
        },
        manualWatchController,
        watchTransport,
      }),
    );

    await watchTransport.start(streamer);
    await session.checkDropProgress();

    expect(state.appState.manualWatchState).toBe('eligible-manual');
    expect(starts).toBe(1);
    expect(stops).toBe(1);
    expect(ticks).toBe(0);
    const refreshesDuringManualPlayback = refreshes;
    expect(refreshesDuringManualPlayback).toBeGreaterThan(0);

    await session.checkDropProgress();
    expect(starts).toBe(1);
    expect(stops).toBe(1);
    expect(ticks).toBe(0);

    // Given: the transport is suspended by the last durable manual-watch decision.
    observationFails = true;

    // When: the next browser observation fails.
    await session.checkDropProgress();

    // Then: the previous suspension and UI projection remain unchanged.
    expect(state.appState.manualWatchState).toBe('eligible-manual');
    expect(starts).toBe(1);
    expect(stops).toBe(1);
    expect(ticks).toBe(0);

    observationFails = false;
    manualPlayback = false;
    chromeMocks.tabs.setTabsQueryResult([]);
    await session.checkDropProgress();

    expect(state.appState.manualWatchState).toBe('inactive');
    expect(starts).toBe(2);
    expect(stops).toBe(1);
    expect(ticks).toBe(0);
    expect(refreshes).toBeGreaterThan(refreshesDuringManualPlayback);

    await session.checkDropProgress();
    expect(ticks).toBe(1);
    await session.handleStopFarming();
    chromeMocks.tabs.setTabsQueryResult([]);
  });
});
