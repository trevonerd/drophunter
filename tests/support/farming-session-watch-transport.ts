import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

export type FarmingSessionAdapters = Parameters<typeof createFarmingSession>[1];

export const watchTransportGame: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game',
  rewardSummary: { completion: 'farmable', remainderReasons: [] },
};

export const watchTransportStreamer: TwitchStreamer = {
  id: 'channel-1',
  name: 'channel-1',
  displayName: 'Channel 1',
  isLive: true,
};

export function createWatchTransportDrop(game: TwitchGame, id = 'drop-1'): TwitchDrop {
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

export function createWatchTransportState() {
  const state = createServiceWorkerState();
  const drop = createWatchTransportDrop(watchTransportGame);
  state.appState.availableGames = [watchTransportGame];
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.appState.currentDrop = drop;
  state.cachedDropsSnapshot = [drop];
  return state;
}

export function createWatchHealth(mode: WatchHealth['mode']): WatchHealth {
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

export function createWatchTransportAdapters(
  overrides: Partial<FarmingSessionAdapters> = {},
): FarmingSessionAdapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () =>
      Object.assign([watchTransportStreamer], { languageFilterApplied: true }),
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
