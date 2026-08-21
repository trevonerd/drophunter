import { createInitialState } from '../shared/utils.ts';
import type { AppState, TwitchDrop, TwitchGame } from '../types/index.ts';
import type { TwitchSession } from './twitch-api/types.ts';
import { parseUnverifiableRewardKey } from './unverifiable-reward-key.ts';

export interface UnverifiableRewardMarker {
  progress: number;
  currentMinutes: number;
  markedAt: number;
}

export interface TimingState {
  lastStreamRotationAt: number;
  streamValidationGraceUntil: number;
  invalidStreamChecks: number;
  noProgressRotationAttempts: number;
  twitchSessionLastAttemptAt: number;
  dropClaimRetryAtById: Record<string, number>;
  lastProgressAdvanceAt: number;
  lastTrackedProgress: number;
  lastTrackedMinutes: number;
  lastTrackedDropKey: string | null;
  apiConsecutiveFailures: number;
  apiBackoffUntil: number;
  integrityFallbackActive: boolean;
  integrityFallbackActiveUntil: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  recoveryNotificationSent: boolean;
  lastHeartbeatAt: number;
  // Consecutive offline readings for the active stream; confirms a real outage before rotating.
  offlineChecks: number;
  // Channel to skip on the next streamer selection (the one we are rotating away from).
  avoidStreamerName: string | null;
  // Allowed-channel filter per campaign; must survive SW restart or a
  // recycled worker can open a non-allowed streamer until the next full fetch.
  cachedCampaignChannelsMap: Record<string, string[] | null>;
  previousAllDropsCount: number;
  unverifiableRewardsByKey: Record<string, UnverifiableRewardMarker>;
}

export function createInitialTimingState(): TimingState {
  return {
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    invalidStreamChecks: 0,
    noProgressRotationAttempts: 0,
    twitchSessionLastAttemptAt: 0,
    dropClaimRetryAtById: {},
    lastProgressAdvanceAt: 0,
    lastTrackedProgress: -1,
    lastTrackedMinutes: -1,
    lastTrackedDropKey: null,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastHeartbeatAt: 0,
    offlineChecks: 0,
    avoidStreamerName: null,
    cachedCampaignChannelsMap: {},
    previousAllDropsCount: 0,
    unverifiableRewardsByKey: {},
  };
}

export function normalizeTimingState(input: unknown, now = Date.now()): TimingState {
  const initial = createInitialTimingState();
  if (!input || typeof input !== 'object') {
    return initial;
  }

  const source = input as Partial<TimingState>;
  const integrityFallbackActiveUntil =
    typeof source.integrityFallbackActiveUntil === 'number' &&
    Number.isFinite(source.integrityFallbackActiveUntil)
      ? source.integrityFallbackActiveUntil
      : 0;
  const integrityFallbackActive =
    Boolean(source.integrityFallbackActive) && integrityFallbackActiveUntil > now;
  const recoveryBackoffUntil =
    typeof source.recoveryBackoffUntil === 'number' && Number.isFinite(source.recoveryBackoffUntil)
      ? source.recoveryBackoffUntil
      : 0;

  return {
    lastStreamRotationAt:
      typeof source.lastStreamRotationAt === 'number' && Number.isFinite(source.lastStreamRotationAt)
        ? source.lastStreamRotationAt
        : initial.lastStreamRotationAt,
    streamValidationGraceUntil:
      typeof source.streamValidationGraceUntil === 'number' &&
      Number.isFinite(source.streamValidationGraceUntil)
        ? source.streamValidationGraceUntil
        : initial.streamValidationGraceUntil,
    invalidStreamChecks:
      typeof source.invalidStreamChecks === 'number' && Number.isFinite(source.invalidStreamChecks)
        ? source.invalidStreamChecks
        : initial.invalidStreamChecks,
    noProgressRotationAttempts:
      typeof source.noProgressRotationAttempts === 'number' &&
      Number.isFinite(source.noProgressRotationAttempts)
        ? source.noProgressRotationAttempts
        : initial.noProgressRotationAttempts,
    twitchSessionLastAttemptAt:
      typeof source.twitchSessionLastAttemptAt === 'number' &&
      Number.isFinite(source.twitchSessionLastAttemptAt)
        ? source.twitchSessionLastAttemptAt
        : initial.twitchSessionLastAttemptAt,
    dropClaimRetryAtById:
      source.dropClaimRetryAtById && typeof source.dropClaimRetryAtById === 'object'
        ? source.dropClaimRetryAtById
        : initial.dropClaimRetryAtById,
    lastProgressAdvanceAt:
      typeof source.lastProgressAdvanceAt === 'number' && Number.isFinite(source.lastProgressAdvanceAt)
        ? source.lastProgressAdvanceAt
        : initial.lastProgressAdvanceAt,
    lastTrackedProgress:
      typeof source.lastTrackedProgress === 'number' && Number.isFinite(source.lastTrackedProgress)
        ? source.lastTrackedProgress
        : initial.lastTrackedProgress,
    lastTrackedMinutes:
      typeof source.lastTrackedMinutes === 'number' && Number.isFinite(source.lastTrackedMinutes)
        ? source.lastTrackedMinutes
        : initial.lastTrackedMinutes,
    lastTrackedDropKey:
      typeof source.lastTrackedDropKey === 'string' && source.lastTrackedDropKey.length > 0
        ? source.lastTrackedDropKey
        : initial.lastTrackedDropKey,
    apiConsecutiveFailures:
      typeof source.apiConsecutiveFailures === 'number' && Number.isFinite(source.apiConsecutiveFailures)
        ? source.apiConsecutiveFailures
        : initial.apiConsecutiveFailures,
    apiBackoffUntil:
      typeof source.apiBackoffUntil === 'number' && Number.isFinite(source.apiBackoffUntil)
        ? source.apiBackoffUntil
        : initial.apiBackoffUntil,
    integrityFallbackActive,
    integrityFallbackActiveUntil: integrityFallbackActive ? integrityFallbackActiveUntil : 0,
    recoveryBackoffUntil: recoveryBackoffUntil > now ? recoveryBackoffUntil : 0,
    lastRecoveryAttemptAt:
      typeof source.lastRecoveryAttemptAt === 'number' && Number.isFinite(source.lastRecoveryAttemptAt)
        ? source.lastRecoveryAttemptAt
        : initial.lastRecoveryAttemptAt,
    stalledRecoveryAttempts:
      typeof source.stalledRecoveryAttempts === 'number' && Number.isFinite(source.stalledRecoveryAttempts)
        ? source.stalledRecoveryAttempts
        : initial.stalledRecoveryAttempts,
    recoveryNotificationSent: Boolean(source.recoveryNotificationSent) && recoveryBackoffUntil > now,
    lastHeartbeatAt:
      typeof source.lastHeartbeatAt === 'number' && Number.isFinite(source.lastHeartbeatAt)
        ? source.lastHeartbeatAt
        : initial.lastHeartbeatAt,
    offlineChecks:
      typeof source.offlineChecks === 'number' && Number.isFinite(source.offlineChecks)
        ? source.offlineChecks
        : initial.offlineChecks,
    avoidStreamerName:
      typeof source.avoidStreamerName === 'string' && source.avoidStreamerName.length > 0
        ? source.avoidStreamerName
        : initial.avoidStreamerName,
    cachedCampaignChannelsMap: normalizeCachedCampaignChannelsMap(source.cachedCampaignChannelsMap),
    previousAllDropsCount:
      typeof source.previousAllDropsCount === 'number' && Number.isFinite(source.previousAllDropsCount)
        ? source.previousAllDropsCount
        : initial.previousAllDropsCount,
    unverifiableRewardsByKey: normalizeUnverifiableRewardsByKey(source.unverifiableRewardsByKey),
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isUnverifiableRewardMarker(input: unknown): input is UnverifiableRewardMarker {
  if (!isRecord(input)) {
    return false;
  }

  return (
    typeof input.progress === 'number' &&
    Number.isFinite(input.progress) &&
    input.progress >= 0 &&
    input.progress <= 100 &&
    typeof input.currentMinutes === 'number' &&
    Number.isFinite(input.currentMinutes) &&
    input.currentMinutes >= 0 &&
    typeof input.markedAt === 'number' &&
    Number.isFinite(input.markedAt) &&
    input.markedAt >= 0
  );
}

function normalizeUnverifiableRewardsByKey(input: unknown): Record<string, UnverifiableRewardMarker> {
  if (!isRecord(input)) {
    return {};
  }

  const result: Record<string, UnverifiableRewardMarker> = {};
  for (const [key, value] of Object.entries(input)) {
    if (parseUnverifiableRewardKey(key) === null || !isUnverifiableRewardMarker(value)) {
      continue;
    }
    result[key] = {
      progress: value.progress,
      currentMinutes: value.currentMinutes,
      markedAt: value.markedAt,
    };
  }
  return result;
}

function normalizeCachedCampaignChannelsMap(input: unknown): Record<string, string[] | null> {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const result: Record<string, string[] | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === null) {
      result[key] = null;
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      result[key] = value;
    }
  }
  return result;
}

export function clearRotationMetadata(state: AppState): AppState {
  return {
    ...state,
    lastRotationReason: null,
    lastRotationAt: null,
  };
}

// On extension update: preserve lifetime stats, user settings, and active farming
// intent; wipe volatile state that may have schema changes. Caller owns the storage
// side-effects (clearing cached keys + persisting the new appState).
export function applyExtensionUpdateStateTransition(state: ServiceWorkerState): void {
  const preserved = {
    ...pickDurablePreferences(state.appState),
    queue: state.appState.queue,
    selectedGame: state.appState.selectedGame,
    isRunning: state.appState.isRunning,
  };
  state.appState = clearRotationMetadata({
    ...createInitialState(),
    ...preserved,
  });
  state.cachedDropsSnapshot = [];
}

// Fields both the extension-update transition and the inactivity reset preserve.
// Extension update additionally keeps active farming intent (queue/selectedGame/
// isRunning); inactivity reset deliberately wipes it as volatile session state.
export function pickDurablePreferences(appState: AppState) {
  return {
    totalDropsClaimed: appState.totalDropsClaimed,
    totalChannelPointsClaimed: appState.totalChannelPointsClaimed,
    monitorAutoOpen: appState.monitorAutoOpen,
    autoResumeOnStartup: appState.autoResumeOnStartup,
    muteFarmingTab: appState.muteFarmingTab,
    notificationsEnabled: appState.notificationsEnabled,
    telegramAlertsEnabled: appState.telegramAlertsEnabled,
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

export type StartupResumePolicyResult = 'not-stale' | 'auto-resume' | 'paused-on-startup' | 'resume-recovery';

// Recovery reasons that can leave no managed tab open, making the SW dormant during
// the retry backoff. A routine SW recycle in this state must not be misclassified as
// a crash — preserve recovery state and let the next tick continue retry→skip→advance.
const ACTIVE_NO_TAB_RECOVERY_REASONS = new Set(['no-streamers', 'offline', 'open-failed']);

export interface StartupResumePolicyState {
  appState: AppState;
  lastHeartbeatAt: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  recoveryNotificationSent: boolean;
}

export function applyStartupResumePolicy(
  state: StartupResumePolicyState,
  now: number,
  staleThresholdMs: number,
  resumeRecoveryGraceMs: number,
): StartupResumePolicyResult {
  const shouldApplyStartupPolicy =
    state.appState.isRunning &&
    !state.appState.isPaused &&
    state.lastHeartbeatAt > 0 &&
    now - state.lastHeartbeatAt > staleThresholdMs;

  if (!shouldApplyStartupPolicy) {
    return 'not-stale';
  }

  const heartbeatGap = now - state.lastHeartbeatAt;
  const hasActiveNoTabRecovery =
    typeof state.appState.recoveryReason === 'string' &&
    ACTIVE_NO_TAB_RECOVERY_REASONS.has(state.appState.recoveryReason);
  if (hasActiveNoTabRecovery && heartbeatGap < resumeRecoveryGraceMs) {
    // Routine SW recycle during a no-tab recovery backoff — do NOT pause/wipe.
    // Let the next checkDropProgress tick continue retry → skip → advance.
    return 'resume-recovery';
  }

  if (state.appState.autoResumeOnStartup) {
    return 'auto-resume';
  }

  state.appState = {
    ...state.appState,
    isPaused: true,
    tabId: null,
    activeStreamer: null,
    recoveryReason: null,
    recoveryBackoffUntil: null,
    recoveryAttempts: null,
    resumedFromCrash: null,
  };
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;

  return 'paused-on-startup';
}

export function shouldCloseManagedTab(windowTabCount: number | null | undefined): boolean {
  return typeof windowTabCount === 'number' && Number.isFinite(windowTabCount) && windowTabCount > 1;
}

export interface ServiceWorkerState {
  appState: AppState;
  monitorTickInFlight: boolean;
  // Bumped by stop/start of the farming session; an in-flight tick compares
  // its captured generation after each await to detect a session restart
  // mid-tick and abort instead of mutating state for a session that ended.
  tickGeneration: number;
  invalidStreamChecks: number;
  lastStreamRotationAt: number;
  streamValidationGraceUntil: number;
  lastTrackedProgress: number;
  lastTrackedMinutes: number;
  lastTrackedDropKey: string | null;
  lastProgressAdvanceAt: number;
  noProgressRotationAttempts: number;
  // Consecutive offline readings for the active stream; confirms a real outage before rotating.
  offlineChecks: number;
  // Channel to skip on the next streamer selection (the one we are rotating away from).
  avoidStreamerName: string | null;
  playbackAttentionWarningSent: boolean;
  gamesCacheRefreshInFlight: Promise<TwitchGame[]> | null;
  twitchSessionCache: TwitchSession | null;
  twitchSessionFetchInFlight: Promise<TwitchSession | null> | null;
  twitchSessionLastAttemptAt: number;
  cachedDropsSnapshot: TwitchDrop[];
  previousAllDropsCount: number;
  cachedCampaignChannelsMap: Record<string, string[] | null>;
  lastFullRefreshAt: number;
  dropClaimInFlight: boolean;
  dropClaimRetryAtById: Map<string, number>;
  queueMissingStreak: Map<string, number>;
  lastActivityAt: number;
  apiConsecutiveFailures: number;
  apiBackoffUntil: number;
  integrityFallbackActive: boolean;
  integrityFallbackActiveUntil: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  recoveryNotificationSent: boolean;
  lastHeartbeatAt: number;
  lastGamesCacheRefreshAt: number;
  // Consecutive empty-campaign API responses; require more than one before
  // treating an empty snapshot as authoritative and wiping queue/games.
  emptyCampaignRefreshStreak: number;
  unverifiableRewardsByKey: Record<string, UnverifiableRewardMarker>;
}

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
    lastGamesCacheRefreshAt: 0,
    emptyCampaignRefreshStreak: 0,
    unverifiableRewardsByKey: {},
  };
}
