import { createFarmingSession } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { TwitchSession } from '../../src/background/twitch-api/types.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

type FarmingSessionAdapters = Parameters<typeof createFarmingSession>[1];

export const afkGame: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  categorySlug: 'game',
  rewardSummary: { completion: 'farmable', remainderReasons: [] },
};

export const afkStreamer: TwitchStreamer = {
  id: 'channel-1',
  name: 'channel-1',
  displayName: 'Channel 1',
  isLive: true,
};

export const afkDrop: TwitchDrop = {
  id: 'drop-1',
  name: 'Reward',
  gameId: afkGame.id,
  gameName: afkGame.name,
  imageUrl: '',
  progress: 10,
  currentMinutes: 1,
  claimed: false,
  campaignId: afkGame.campaignId,
  status: 'active',
  requiredMinutes: 10,
  remainingMinutes: 9,
  acquisitionMethod: 'watch-time',
  rewardKind: 'unknown',
  verificationState: 'unassessed',
};

export const expiredTwitchSession: TwitchSession = {
  oauthToken: 'expired-token',
  userId: 'viewer-1',
  deviceId: 'device-1',
  uuid: 'uuid-1',
};

export function createAfkState() {
  const state = createServiceWorkerState();
  state.appState.availableGames = [afkGame];
  state.appState.queue = [afkGame];
  state.appState.selectedGame = afkGame;
  state.appState.activeStreamer = afkStreamer;
  state.appState.currentDrop = afkDrop;
  state.appState.pendingDrops = [afkDrop];
  state.appState.allDrops = [afkDrop];
  state.appState.isRunning = true;
  state.cachedDropsSnapshot = [afkDrop];
  state.twitchSessionCache = expiredTwitchSession;
  return state;
}

export function healthyWatch(): WatchHealth {
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

export function createAfkAdapters(overrides: Partial<FarmingSessionAdapters> = {}): FarmingSessionAdapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => expiredTwitchSession,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () => Object.assign([afkStreamer], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => afkGame.categorySlug ?? null,
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
