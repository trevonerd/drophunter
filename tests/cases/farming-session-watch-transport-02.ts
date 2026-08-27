import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dropStateKey } from '../../src/background/drops-projection.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';

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

const _nextGame: TwitchGame = {
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
  test('fresh Hidden progress clears recovery without restarting the watcher', async () => {
    const realDateNow = Date.now;
    const now = 2_000_000;
    Date.now = () => now;
    const state = createState();
    const staleDrop = state.appState.currentDrop;
    if (!staleDrop) throw new Error('Expected an active drop in the test fixture');
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    state.appState.recoveryReason = 'stalled-progress';
    state.appState.recoveryAttempts = 1;
    state.stalledRecoveryAttempts = 1;
    state.recoveryBackoffUntil = now;
    state.lastTrackedDropKey = dropStateKey(staleDrop);
    state.lastTrackedProgress = staleDrop.progress;
    state.lastTrackedMinutes = staleDrop.currentMinutes ?? -1;
    const progressedDrop = { ...staleDrop, progress: 20, currentMinutes: 2, remainingMinutes: 8 };
    let hiddenStarts = 0;

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({
            games: [game],
            drops: [progressedDrop],
            updatedAt: now,
          }),
          fetchInventorySnapshotFromApi: async () => ({
            games: [game],
            drops: [progressedDrop],
            updatedAt: now,
          }),
          watchTransport: {
            start: async () => {
              hiddenStarts += 1;
              return createHealth('tabless');
            },
            tick: async () => createHealth('tabless'),
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();

      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.appState.recoveryReason).toBeNull();
      expect(state.appState.currentDrop?.progress).toBe(20);
      expect(hiddenStarts).toBe(0);
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
    } finally {
      Date.now = realDateNow;
    }
  });
});
