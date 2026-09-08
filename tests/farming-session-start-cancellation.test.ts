import { describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

type Adapters = Parameters<typeof createFarmingSession>[1];

const game: TwitchGame = {
  id: 'game-1',
  name: 'Game 1',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game-1',
};

const drop: TwitchDrop = {
  id: 'drop-1',
  name: 'Drop 1',
  gameId: game.id,
  gameName: game.name,
  imageUrl: '',
  campaignId: game.campaignId,
  progress: 10,
  currentMinutes: 10,
  requiredMinutes: 60,
  remainingMinutes: 50,
  claimed: false,
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};

function createAdapters(overrides: Partial<Adapters> = {}): Adapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => ({ games: [game], drops: [drop], updatedAt: Date.now() }),
    fetchInventorySnapshotFromApi: async () => ({ games: [game], drops: [drop], updatedAt: Date.now() }),
    fetchDirectoryStreamersFromApi: async () => Object.assign([], { languageFilterApplied: false }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => game.categorySlug ?? '',
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

describe('farming session start cancellation', () => {
  test('does not open playback when streamer discovery completes after cancellation', async () => {
    const state = createServiceWorkerState();
    state.appState.availableGames = [game];
    state.appState.allDrops = [drop];
    state.appState.pendingDrops = [drop];
    state.appState.currentDrop = drop;
    state.appState.selectedGame = game;
    state.cachedDropsSnapshot = [drop];
    const directory = createDeferred<TwitchStreamer[] & { languageFilterApplied: boolean }>();
    const directoryStarted = createDeferred<void>();
    let foregroundOpens = 0;
    const session = createFarmingSession(
      state,
      createAdapters({
        fetchDirectoryStreamersFromApi: async () => {
          directoryStarted.resolve(undefined);
          return directory.promise;
        },
        openForegroundChannel: async () => {
          foregroundOpens += 1;
        },
      }),
    );
    let current = true;

    const start = session.handleStartFarming({ game }, () => current);
    await directoryStarted.promise;
    current = false;
    directory.resolve(
      Object.assign([{ id: 'streamer-1', name: 'streamer', displayName: 'Streamer', isLive: true }], {
        languageFilterApplied: false,
      }),
    );

    await expect(start).resolves.toEqual({ success: false, error: 'Farming start was superseded.' });
    expect(foregroundOpens).toBe(0);
  });
});
