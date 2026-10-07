import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { ServiceWorkerState } from '../../src/background/service-worker.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { AppState } from '../../src/types/index.ts';

export function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    ...createServiceWorkerState(),
    appState: createInitialState(),
    monitorTickInFlight: false,
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
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

export function createAppState(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialState(), ...overrides };
}
