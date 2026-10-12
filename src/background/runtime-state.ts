import { createInitialState } from '../shared/utils.ts';
import type { AppState, TwitchDrop } from '../types/index.ts';
import type { UnverifiableRewardMarker } from './runtime-timing-state.ts';
import type { TwitchSession } from './twitch-api/types.ts';

export { applyStartupAutoResumeTransition, applyStartupResumePolicy } from './runtime-startup-policy.ts';
export type { TimingState } from './runtime-timing-state.ts';
export {
  createInitialTimingState,
  normalizeTimingState,
} from './runtime-timing-state.ts';

export function clearRotationMetadata(state: AppState): AppState {
  return { ...state, lastRotationReason: null, lastRotationAt: null };
}

export function pickDurablePreferences(appState: AppState) {
  return {
    totalDropsClaimed: appState.totalDropsClaimed,
    totalChannelPointsClaimed: appState.totalChannelPointsClaimed,
    monitorAutoOpen: appState.monitorAutoOpen,
    muteFarmingTab: appState.muteFarmingTab,
    notificationsEnabled: appState.notificationsEnabled,
    telegramAlertsEnabled: appState.telegramAlertsEnabled,
    telegramSystemAlertsEnabled: appState.telegramSystemAlertsEnabled,
    autoClaimChannelPointsBonus: appState.autoClaimChannelPointsBonus,
    autoClaimDrops: appState.autoClaimDrops,
    streamerSelectionMode: appState.streamerSelectionMode,
    preferredStreamerLanguage: appState.preferredStreamerLanguage,
    watchTransportPreference: appState.watchTransportPreference,
    favoriteGames: appState.favoriteGames,
    hiddenGames: appState.hiddenGames,
    campaignPriorityMode: appState.campaignPriorityMode,
    farmCategoryScope: appState.farmCategoryScope,
    autoStartFavoriteGames: appState.autoStartFavoriteGames,
  };
}

export function shouldCloseManagedTab(windowTabCount: number | null | undefined): boolean {
  return typeof windowTabCount === 'number' && Number.isFinite(windowTabCount) && windowTabCount > 1;
}

export interface ServiceWorkerState {
  appState: AppState;
  backupImportInProgress: boolean;
  backupImportCompletion: Promise<void> | null;
  backupImportRequested: boolean;
  runtimeHandlersInFlight: number;
  optionalPermissionRevisions: { notificationsEnabled: number; telegramAlertsEnabled: number };
  monitorTickInFlight: boolean;
  cancelledAcquisitionMonitoringWake: (() => boolean) | null;
  monitorTickDeadlineAt: number;
  streamerAcquisitionInFlight: Promise<boolean> | null;
  queueProgressionInFlight: {
    readonly epoch: number;
    readonly generation: number;
    readonly promise: Promise<boolean>;
  } | null;
  streamerAcquisitionDeadlineAt: number;
  streamerAcquisitionGeneration: number;
  streamerAcquisitionPhase: 'directory' | 'playback' | null;
  preparingManagedTabIds: Set<number>;
  tickGeneration: number;
  invalidStreamChecks: number;
  lastStreamRotationAt: number;
  streamValidationGraceUntil: number;
  lastTrackedProgress: number;
  lastTrackedMinutes: number;
  lastTrackedDropKey: string | null;
  lastProgressAdvanceAt: number;
  noProgressRotationAttempts: number;
  offlineChecks: number;
  avoidStreamerName: string | null;
  twitchSessionCache: TwitchSession | null;
  twitchSessionFetchInFlight: Promise<TwitchSession | null> | null;
  twitchSessionLastAttemptAt: number;
  cachedDropsSnapshot: TwitchDrop[];
  previousAllDropsCount: number;
  cachedCampaignChannelsMap: Record<string, string[] | null>;
  lastFullRefreshAt: number;
  lastInventoryRefreshAt: number;
  dropClaimInFlight: boolean;
  dropClaimRetryAtById: Map<string, number>;
  lastActivityAt: number;
  apiConsecutiveFailures: number;
  apiBackoffUntil: number;
  apiRetryAfterVerifiedAt?: number;
  integrityFallbackActive: boolean;
  integrityFallbackActiveUntil: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  lastHeartbeatAt: number;
  lastLifecycleCheckAt: number;
  lastGamesCacheRefreshAt: number;
  hasCurrentGenerationCampaignValidation: boolean;
  unverifiableRewardsByKey: Record<string, UnverifiableRewardMarker>;
}

export function createServiceWorkerState(): ServiceWorkerState {
  return {
    appState: createInitialState(),
    backupImportInProgress: false,
    backupImportCompletion: null,
    backupImportRequested: false,
    runtimeHandlersInFlight: 0,
    optionalPermissionRevisions: { notificationsEnabled: 0, telegramAlertsEnabled: 0 },
    monitorTickInFlight: false,
    cancelledAcquisitionMonitoringWake: null,
    monitorTickDeadlineAt: 0,
    streamerAcquisitionInFlight: null,
    queueProgressionInFlight: null,
    streamerAcquisitionDeadlineAt: 0,
    streamerAcquisitionGeneration: 0,
    streamerAcquisitionPhase: null,
    preparingManagedTabIds: new Set(),
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
    apiRetryAfterVerifiedAt: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    lastHeartbeatAt: 0,
    lastLifecycleCheckAt: 0,
    lastGamesCacheRefreshAt: 0,
    hasCurrentGenerationCampaignValidation: false,
    unverifiableRewardsByKey: {},
  };
}
