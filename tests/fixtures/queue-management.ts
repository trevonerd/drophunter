import { dropStateKey } from '../../src/background/drops-projection.ts';
import { createFarmingSession, type FarmingSessionAdapters } from '../../src/background/farming-session.ts';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS } from '../../src/background/stream-rotation.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

export function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
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
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
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
    queueMissingStreak: new Map(),
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
    closeManagedTabIfSafe: async () => true,
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

export function createExhaustedRecoveryFixture(options: {
  progress: number;
  currentMinutes: number;
  campaignId?: string;
  rewardKind?: TwitchDrop['rewardKind'];
  additionalDrops?: TwitchDrop[];
}) {
  const campaignId = options.campaignId ?? 'native-campaign';
  const game = createGame({
    id: 'native-game',
    name: 'Native Game',
    campaignId,
    categorySlug: 'native-game',
    dropCount: 1 + (options.additionalDrops?.length ?? 0),
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const nativeReward = createDrop({
    id: 'native-reward',
    gameId: game.id,
    gameName: game.name,
    campaignId,
    categorySlug: game.categorySlug,
    progress: options.progress,
    currentMinutes: options.currentMinutes,
    requiredMinutes: 60,
    remainingMinutes: Math.max(0, 60 - options.currentMinutes),
    acquisitionMethod: 'watch-time',
    rewardKind: options.rewardKind ?? 'twitch-badge',
    verificationState: 'unassessed',
  });
  const rewards = [nativeReward, ...(options.additionalDrops ?? [])];
  const state = createMinimalState();
  state.appState.isRunning = true;
  state.appState.selectedGame = game;
  state.appState.availableGames = [game];
  state.appState.queue = [game];
  state.appState.allDrops = rewards;
  state.appState.pendingDrops = rewards;
  state.appState.currentDrop = nativeReward;
  state.appState.tabId = 123;
  state.appState.activeStreamer = createStreamer({ name: 'stalled-streamer' });
  state.appState.recoveryReason = 'stalled-progress';
  state.appState.recoveryAttempts = MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS;
  state.cachedDropsSnapshot = rewards;
  state.previousAllDropsCount = rewards.length;
  state.lastFullRefreshAt = Date.now();
  state.lastTrackedDropKey = dropStateKey(nativeReward);
  state.lastTrackedProgress = options.progress;
  state.lastTrackedMinutes = options.currentMinutes;
  state.lastProgressAdvanceAt = Date.now() - 10 * 60 * 1000;
  state.stalledRecoveryAttempts = MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS;
  return { game, nativeReward, state };
}

export function createStalledRecoverySession(
  state: ServiceWorkerState,
  overrides: Partial<FarmingSessionAdapters> = {},
) {
  return createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchStreamContext: async () => ({
        channelName: 'stalled-streamer',
        categorySlug: 'native-game',
        categoryLabel: 'Native Game',
        streamTitle: 'Drops',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        pageUrl: 'https://twitch.tv/stalled-streamer',
      }),
      ...overrides,
    }),
  );
}
