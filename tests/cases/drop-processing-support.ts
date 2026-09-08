import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { createInitialState } from '../../src/shared/utils.ts';

export * from '../../src/background/drops-projection.ts';
export { refreshDropsData } from '../../src/background/drops-tick.ts';
export type { ServiceWorkerState } from '../../src/background/service-worker.ts';
export { dropMatchesGame } from '../../src/shared/game-selection.ts';
export { createInitialState } from '../../src/shared/utils.ts';
export type { TwitchDrop, TwitchGame } from '../../src/types/index.ts';

export function makeState(overrides = {}) {
  const appState = {
    ...createInitialState(),
    selectedGame: null,
    allDrops: [],
    pendingDrops: [],
    completedDrops: [],
    currentDrop: null,
    availableGames: [],
  };
  return {
    appState,
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: -1,
    lastTrackedMinutes: -1,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
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
    dropClaimRetryById: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    unverifiableRewardsByKey: {},
    ...overrides,
  } as ServiceWorkerState;
}
