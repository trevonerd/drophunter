import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { computeEffectiveStallThreshold } from '../../src/background/stream-rotation.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import { preparedWatch } from '../support/prepared-watch.ts';

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

const replacementStreamer: TwitchStreamer = {
  id: 'channel-2',
  name: 'channel-2',
  displayName: 'Channel 2',
  isLive: true,
};

const nextGame: TwitchGame = {
  ...game,
  id: 'game-2',
  name: 'Next Game',
  campaignId: 'campaign-2',
  categorySlug: 'next-game',
};

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

function fixtureDrop(game: TwitchGame, id = 'drop-1'): TwitchDrop {
  return {
    id,
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
  test('a second Hidden stall attempt replaces the current streamer', async () => {
    const realDateNow = Date.now;
    let now = 3_500_000;
    Date.now = () => now;
    const state = createState();
    const currentDrop = fixtureDrop(game);
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    const starts: string[] = [];
    const stalledHealth: WatchHealth = {
      ...createHealth('tabless'),
      isHealthy: false,
      status: 'stalled',
      reason: 'stalled-progress',
      consecutiveStalls: 10,
      shouldFallback: true,
    };

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({
            games: [game],
            drops: [currentDrop],
            campaignsVerified: true,
            inventoryVerified: true,
            updatedAt: now,
          }),
          fetchInventorySnapshotFromApi: async (drops) => ({
            games: [game],
            drops,
            inventoryVerified: true,
            updatedAt: now,
          }),
          fetchDirectoryStreamersFromApi: async () =>
            Object.assign([streamer, replacementStreamer], { languageFilterApplied: true }),
          watchTransport: {
            prepare: async (target) => {
              starts.push(target.channelName);
              return preparedWatch(target, createHealth('tabless'));
            },
            start: async (candidate) => {
              starts.push(candidate.name);
              return { kind: 'started', health: createHealth('tabless') };
            },
            tick: async () => stalledHealth,
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();
      expect(starts).toEqual(['channel-1']);

      now += computeEffectiveStallThreshold(currentDrop.requiredMinutes);
      await session.checkDropProgress();

      expect(starts).toEqual(['channel-1', 'channel-2']);
      expect(state.appState.activeStreamer?.name).toBe('channel-2');
      expect(state.stalledRecoveryAttempts).toBe(2);
    } finally {
      Date.now = realDateNow;
    }
  });

  test('fresh no-progress proof plus verified alternative exhaustion parks behind the next campaign', async () => {
    const realDateNow = Date.now;
    let now = 4_000_000;
    Date.now = () => now;
    const state = createState();
    const currentDrop = fixtureDrop(game);
    const nextDrop = fixtureDrop(nextGame, 'drop-2');
    state.appState.selectedGame = game;
    state.appState.queue = [game, nextGame];
    state.appState.availableGames = [game, nextGame];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    let hiddenStarts = 0;
    const suppressedCampaignKeys: string[] = [];
    const stalledHealth: WatchHealth = {
      ...createHealth('tabless'),
      isHealthy: false,
      status: 'stalled',
      reason: 'stalled-progress',
      consecutiveStalls: 10,
      shouldFallback: true,
    };

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({
            games: [game, nextGame],
            drops: [currentDrop, nextDrop],
            campaignsVerified: true,
            inventoryVerified: true,
            updatedAt: now,
          }),
          fetchInventorySnapshotFromApi: async (drops) => ({
            games: [game, nextGame],
            drops,
            inventoryVerified: true,
            updatedAt: now,
          }),
          suppressCampaignUntilRefresh: async (campaignKey) => {
            suppressedCampaignKeys.push(campaignKey);
            return 'suppressed';
          },
          watchTransport: {
            prepare: async (target) => {
              hiddenStarts += 1;
              return preparedWatch(target, createHealth('tabless'));
            },
            start: async () => {
              hiddenStarts += 1;
              return { kind: 'started', health: createHealth('tabless') };
            },
            tick: async () => stalledHealth,
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();
      expect(state.stalledRecoveryAttempts).toBe(1);
      now += computeEffectiveStallThreshold(currentDrop.requiredMinutes);
      await session.checkDropProgress();

      expect(state.appState.selectedGame?.campaignId).toBe(nextGame.campaignId);
      expect(state.appState.queue.map((entry) => entry.campaignId)).toEqual([
        nextGame.campaignId,
        game.campaignId,
      ]);
      expect(hiddenStarts).toBeGreaterThan(0);
      expect(state.appState.activeStreamer?.name).toBe(streamer.name);
      expect(state.lastProgressAdvanceAt).toBe(now);
      expect(suppressedCampaignKeys).toEqual([]);
    } finally {
      Date.now = realDateNow;
    }
  });
});
