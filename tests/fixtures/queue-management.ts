import { type FarmingSessionAdapters } from '../../src/background/farming-session.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

export function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    ...createServiceWorkerState(),
    appState: createInitialState(),
    monitorTickInFlight: false,
    tickGeneration: 0,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    offlineChecks: 0,
    avoidStreamerName: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    lastInventoryRefreshAt: 0,
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
    lastHeartbeatAt: 0,
    lastGamesCacheRefreshAt: 0,
    hasCurrentGenerationCampaignValidation: true,
    unverifiableRewardsByKey: {},
    ...overrides,
  };
}

export function createGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-123',
    name: 'Test Game',
    imageUrl: 'https://example.com/game.png',
    ...overrides,
  };
}

export function createStreamer(overrides: Partial<TwitchStreamer> = {}) {
  return {
    id: overrides.id ?? 'streamer-1',
    name: overrides.name ?? 'streamer-1',
    displayName: overrides.displayName ?? 'Streamer 1',
    isLive: overrides.isLive ?? true,
    viewerCount: overrides.viewerCount,
    broadcasterLanguage: overrides.broadcasterLanguage,
    thumbnailUrl: overrides.thumbnailUrl,
  };
}

export function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-123',
    name: 'Test Drop',
    gameId: 'game-123',
    gameName: 'Test Game',
    imageUrl: 'https://example.com/drop.png',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

export function createFarmingSessionAdapters(
  overrides: Partial<FarmingSessionAdapters> = {},
): FarmingSessionAdapters {
  return {
    getInitPromise: () => null,
    trackActivity: async () => {},
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () => Object.assign([], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async (game) => game.categorySlug ?? '',
    openForegroundChannel: async () => {},
    enforcePlaybackPolicyOnStreamTab: async () => {},
    attemptPlaybackSelfHeal: async () => {},
    attemptAutoClaimChannelPointsBonus: async () => false,
    clearManagedTabOwnership: () => {},
    openMonitorDashboardWindow: async () => undefined,
    sendAlert: async () => {},
    notify: async () => {},
    saveState: async () => {},
    saveTimingState: async () => {},
    broadcastStateUpdate: () => {},
    monitorAutoOpenDelayMs: 0,
    ...overrides,
  };
}
