import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../../src/background/farming-automation.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
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
  test('an exhausted Hidden recovery keeps the existing terminal stop when the queue is empty', async () => {
    const realDateNow = Date.now;
    const now = 5_000_000;
    Date.now = () => now;
    const state = createState();
    const currentDrop = fixtureDrop(game);
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    state.appState.recoveryReason = 'stalled-progress';
    state.appState.recoveryAttempts = 3;
    state.stalledRecoveryAttempts = 3;
    state.recoveryBackoffUntil = now;

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({ games: [game], drops: [currentDrop], updatedAt: now }),
          fetchInventorySnapshotFromApi: async (drops) => ({
            games: [game],
            drops,
            updatedAt: now,
          }),
          watchTransport: {
            start: async () => createHealth('tabless'),
            tick: async () => createHealth('tabless'),
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();

      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.queue).toEqual([]);
      expect(state.appState.lastStopReason).toBe('stall-skipped');
    } finally {
      Date.now = realDateNow;
    }
  });

  test('campaign suppression affects automatic selection only and leaves manual start available', async () => {
    const state = createState();
    state.appState.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: 1 }];
    const suppressedKeys: string[] = [];
    const automation = createFarmingAutomation({
      evaluateBatch: async () => ({ kind: 'unchanged', reason: 'no-eligible-campaign' }),
      persistCampaignSuppression: async (campaignKey) => {
        suppressedKeys.push(campaignKey);
        return 'suppressed';
      },
    });

    await automation.suppressCampaignUntilRefresh(gameKey(game));
    const result = await createFarmingSession(state, createAdapters()).handleStartFarming({ game });

    expect(suppressedKeys).toEqual([gameKey(game)]);
    expect(result.success).toBe(true);
    expect(state.appState.favoriteGames).toHaveLength(1);
    expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
  });
});
