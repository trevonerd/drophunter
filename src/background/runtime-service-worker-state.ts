import { createInitialState } from '../shared/utils.ts';
import type { TwitchDrop, TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state-types.ts';

export function createServiceWorkerState(): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    tickGeneration: 0,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: -1,
    lastTrackedMinutes: -1,
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
    lastLifecycleCheckAt: 0,
    lastGamesCacheRefreshAt: 0,
    emptyCampaignRefreshStreak: 0,
    unverifiableRewardsByKey: {},
  };
}

export type GamesCacheRefresh = Promise<TwitchGame[]> | null;
export type CachedDropsSnapshot = TwitchDrop[];
