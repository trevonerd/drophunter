import { isDropCompleted } from '../shared/drops';
import { getGameDisplayLabel, replaceAvailableGames } from '../shared/game-selection';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../shared/runtime-status';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { createInitialState, toSlug } from '../shared/utils';
import { AppState, DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import {
  applyAutoClaimDropsSetting,
  autoClaimClaimableDrops as autoClaimClaimableDropsExt,
} from './auto-claim.ts';
import {
  applyAutoClaimChannelPointsBonusSetting,
  ChannelPointsBonusClaimResponse,
  shouldAttemptAutoClaimChannelPointsBonus,
} from './channel-points';
import { logDebug, logInfo, logWarn } from './logging';
import { registerRuntimeMessageRouter } from './message-router.ts';
import { openMonitorDashboardWindow as openMonitorDashboardWindowController } from './monitor-dashboard.ts';
import { createNotificationController } from './notifications.ts';
import { needsPlaybackAttention } from './playback.ts';
import { createPlaybackOrchestrator } from './playback-orchestrator.ts';
import { applyStartupResumePolicy, clearRotationMetadata } from './runtime-state';
import { createSessionOrchestrator } from './session-orchestrator.ts';
import {
  applyBestEffortAlwaysOnTop as applyBestEffortAlwaysOnTopExt,
  clearManagedTabOwnership as clearManagedTabOwnershipExt,
  closeManagedTabIfSafe as closeManagedTabIfSafeExt,
  ensureManagedTab as ensureManagedTabExt,
  monitorDashboardUrl as monitorDashboardUrlExt,
  shouldMuteManagedFarmingTab as shouldMuteManagedFarmingTabExt,
  streamerWatchUrl as streamerWatchUrlExt,
  syncManagedTabMuteState as syncManagedTabMuteStateExt,
  waitForTabComplete as waitForTabCompleteExt,
} from './tab-management.ts';
import './stream-rotation';
import { fetchDirectoryStreamersFromApiWrapper, fetchDropsSnapshotFromApiWrapper } from './api-operations.ts';
import {
  CRASH_DETECTION_THRESHOLD_MS,
  CRASH_RECOVERY_GRACE_MS,
  PROGRESS_POLL_MS,
  STREAM_VALIDATION_GRACE_MS,
} from './constants.ts';
import {
  annotateGameCompletion as annotateGameCompletionExt,
  dropMatchesSelectedGame as dropMatchesSelectedGameExt,
  normalizeGameSelection as normalizeGameSelectionExt,
  splitDropsForSelectedGame as splitDropsForSelectedGameExt,
  updateStateFromSnapshot as updateStateFromSnapshotExt,
} from './drop-processing.ts';
import { createDropsPageRefresher } from './drops-page-refresh.ts';
import { registerExtensionLifecycleListeners } from './extension-lifecycle.ts';
import {
  advanceQueueIfCompleted as advanceQueueIfCompletedExt,
  applyStopState as applyStopStateExt,
  checkDropProgress as checkDropProgressExt,
  enterPersistentRecovery as enterPersistentRecoveryExt,
  handleAddToQueue as handleAddToQueueExt,
  handleRemoveFromQueue as handleRemoveFromQueueExt,
  handleSetSelectedGame as handleSetSelectedGameExt,
  handleStartFarming as handleStartFarmingExt,
  normalizeQueueSelection as normalizeQueueSelectionExt,
  openBestStreamerForSelectedGame as openBestStreamerForSelectedGameExt,
  refreshDropsData as refreshDropsDataExt,
  removeGameFromQueue as removeGameFromQueueExt,
  resetStreamTrackingState as resetStreamTrackingStateExt,
  resolveGameFromState as resolveGameFromStateExt,
  rotateStreamer as rotateStreamerExt,
  rotateStreamerIfInvalid as rotateStreamerIfInvalidExt,
  skipCurrentGameDueToStall as skipCurrentGameDueToStallExt,
  stopFarmingSession as stopFarmingSessionExt,
} from './queue-management.ts';
import {
  clearTwitchSessionCache as clearTwitchSessionCacheExt,
  ensureSessionIntegrity as ensureSessionIntegrityExt,
  ensureTwitchSession as ensureTwitchSessionExt,
  persistTwitchSession as persistTwitchSessionExt,
  readTwitchSessionViaExecuteScript as readTwitchSessionViaExecuteScriptExt,
} from './session-management.ts';
import {
  broadcastStateUpdate as broadcastStateUpdateExt,
  loadState as loadStateExt,
  loadTimingState as loadTimingStateExt,
  markActivity as markActivityExt,
  resetStateForInactivity as resetStateForInactivityExt,
  saveState as saveStateExt,
  saveTimingState as saveTimingStateExt,
  sessionDebugSummary as sessionDebugSummaryExt,
  shouldRefreshGamesCache as shouldRefreshGamesCacheExt,
} from './state-persistence';
import {
  applyPreferredStreamerLanguageSetting,
  applyStreamerSelectionModeSetting,
  normalizePreferredStreamerLanguage,
  pickStreamerForPreferences,
} from './streamer-selection';
import { TwitchApiClient } from './twitch-api/client';
import { isLikelyAuthError, sanitizeTwitchSession, TwitchSession } from './twitch-api/types';

export interface ServiceWorkerState {
  appState: AppState;
  monitorTickInFlight: boolean;
  invalidStreamChecks: number;
  lastStreamRotationAt: number;
  streamValidationGraceUntil: number;
  lastTrackedProgress: number;
  lastTrackedMinutes: number;
  lastTrackedDropKey: string | null;
  lastProgressAdvanceAt: number;
  noProgressRotationAttempts: number;
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
}

export const FULL_REFRESH_INTERVAL_MS = 2 * 60_000;
export const INVALID_STREAM_THRESHOLD = 8;
export const STREAM_ROTATE_COOLDOWN_MS = 5 * 60_000;
export const TWITCH_SESSION_RETRY_COOLDOWN_MS = 5_000;
export const DROP_CLAIM_RETRY_COOLDOWN_MS = 45_000;
export const MONITOR_AUTO_OPEN_DELAY_MS = 450;
export const TWITCH_SESSION_STORAGE_KEY = 'twitchSession';
export const DROPS_SNAPSHOT_CACHE_KEY = 'dropsSnapshotCache';
export const TIMING_STATE_KEY = 'timingState';
export const LAST_ACTIVITY_AT_KEY = 'lastActivityAt';
export const ALARM_NAME = 'dropCheck';
export const INACTIVITY_RESET_MS = 3 * 24 * 60 * 60_000; // 3 days
export const INTEGRITY_FALLBACK_TTL_MS = 30 * 60_000; // 30 minutes
export const TICK_WATCHDOG_TIMEOUT_MS = 60_000;
export const STREAM_CONTEXT_TIMEOUT_MS = 12_000;

export interface StreamContext {
  channelName: string;
  categorySlug: string;
  categoryLabel: string;
  streamTitle: string;
  titleContainsDrops: boolean;
  hasDropsSignal: boolean;
  isLive: boolean;
  pageUrl: string;
}

function sameCampaignId(left?: string | null, right?: string | null): boolean {
  return Boolean(left && right && left === right);
}

let initPromise: Promise<void> | null = null;
let appState: AppState = createInitialState();
let monitorTickInFlight = false;
let invalidStreamChecks = 0;
let lastStreamRotationAt = 0;
let streamValidationGraceUntil = 0;
let lastTrackedProgress = -1;
let lastTrackedMinutes = -1;
let lastTrackedDropKey: string | null = null;
let lastProgressAdvanceAt = 0;
let noProgressRotationAttempts = 0;
let playbackAttentionWarningSent = false;
let gamesCacheRefreshInFlight: Promise<TwitchGame[]> | null = null;
let twitchSessionCache: TwitchSession | null = null;
let twitchSessionFetchInFlight: Promise<TwitchSession | null> | null = null;
let twitchSessionLastAttemptAt = 0;
let cachedDropsSnapshot: TwitchDrop[] = [];
let previousAllDropsCount = 0;
let cachedCampaignChannelsMap: Record<string, string[] | null> = {};
let lastFullRefreshAt = 0;
let dropClaimInFlight = false;
const dropClaimRetryAtById = new Map<string, number>();
let lastActivityAt = 0;
let apiConsecutiveFailures = 0;
let apiBackoffUntil = 0;
let integrityFallbackActive = false;
let integrityFallbackActiveUntil = 0;
let recoveryBackoffUntil = 0;
let lastRecoveryAttemptAt = 0;
let stalledRecoveryAttempts = 0;
let recoveryNotificationSent = false;
let lastHeartbeatAt = 0;
let lastGamesCacheRefreshAt = 0;

// State wrapper for extracted module functions (state-persistence.ts).
// Uses getter/setter proxy so extracted functions can mutate state through
// `state.xxx = value` while underlying `let` variables get updated.
const state: ServiceWorkerState = {
  get appState() {
    return appState;
  },
  set appState(v) {
    appState = v;
  },
  get monitorTickInFlight() {
    return monitorTickInFlight;
  },
  set monitorTickInFlight(v) {
    monitorTickInFlight = v;
  },
  get invalidStreamChecks() {
    return invalidStreamChecks;
  },
  set invalidStreamChecks(v) {
    invalidStreamChecks = v;
  },
  get lastStreamRotationAt() {
    return lastStreamRotationAt;
  },
  set lastStreamRotationAt(v) {
    lastStreamRotationAt = v;
  },
  get streamValidationGraceUntil() {
    return streamValidationGraceUntil;
  },
  set streamValidationGraceUntil(v) {
    streamValidationGraceUntil = v;
  },
  get lastTrackedProgress() {
    return lastTrackedProgress;
  },
  set lastTrackedProgress(v) {
    lastTrackedProgress = v;
  },
  get lastTrackedMinutes() {
    return lastTrackedMinutes;
  },
  set lastTrackedMinutes(v) {
    lastTrackedMinutes = v;
  },
  get lastTrackedDropKey() {
    return lastTrackedDropKey;
  },
  set lastTrackedDropKey(v) {
    lastTrackedDropKey = v;
  },
  get lastProgressAdvanceAt() {
    return lastProgressAdvanceAt;
  },
  set lastProgressAdvanceAt(v) {
    lastProgressAdvanceAt = v;
  },
  get noProgressRotationAttempts() {
    return noProgressRotationAttempts;
  },
  set noProgressRotationAttempts(v) {
    noProgressRotationAttempts = v;
  },
  get playbackAttentionWarningSent() {
    return playbackAttentionWarningSent;
  },
  set playbackAttentionWarningSent(v) {
    playbackAttentionWarningSent = v;
  },
  get gamesCacheRefreshInFlight() {
    return gamesCacheRefreshInFlight;
  },
  set gamesCacheRefreshInFlight(v) {
    gamesCacheRefreshInFlight = v;
  },
  get twitchSessionCache() {
    return twitchSessionCache;
  },
  set twitchSessionCache(v) {
    twitchSessionCache = v;
  },
  get twitchSessionFetchInFlight() {
    return twitchSessionFetchInFlight;
  },
  set twitchSessionFetchInFlight(v) {
    twitchSessionFetchInFlight = v;
  },
  get twitchSessionLastAttemptAt() {
    return twitchSessionLastAttemptAt;
  },
  set twitchSessionLastAttemptAt(v) {
    twitchSessionLastAttemptAt = v;
  },
  get cachedDropsSnapshot() {
    return cachedDropsSnapshot;
  },
  set cachedDropsSnapshot(v) {
    cachedDropsSnapshot = v;
  },
  get previousAllDropsCount() {
    return previousAllDropsCount;
  },
  set previousAllDropsCount(v) {
    previousAllDropsCount = v;
  },
  get cachedCampaignChannelsMap() {
    return cachedCampaignChannelsMap;
  },
  set cachedCampaignChannelsMap(v) {
    cachedCampaignChannelsMap = v;
  },
  get lastFullRefreshAt() {
    return lastFullRefreshAt;
  },
  set lastFullRefreshAt(v) {
    lastFullRefreshAt = v;
  },
  get dropClaimInFlight() {
    return dropClaimInFlight;
  },
  set dropClaimInFlight(v) {
    dropClaimInFlight = v;
  },
  get dropClaimRetryAtById() {
    return dropClaimRetryAtById;
  },
  set dropClaimRetryAtById(v) {
    dropClaimRetryAtById.clear();
    if (v instanceof Map) {
      for (const [k, val] of v) dropClaimRetryAtById.set(k, val);
    }
  },
  get lastActivityAt() {
    return lastActivityAt;
  },
  set lastActivityAt(v) {
    lastActivityAt = v;
  },
  get apiConsecutiveFailures() {
    return apiConsecutiveFailures;
  },
  set apiConsecutiveFailures(v) {
    apiConsecutiveFailures = v;
  },
  get apiBackoffUntil() {
    return apiBackoffUntil;
  },
  set apiBackoffUntil(v) {
    apiBackoffUntil = v;
  },
  get integrityFallbackActive() {
    return integrityFallbackActive;
  },
  set integrityFallbackActive(v) {
    integrityFallbackActive = v;
  },
  get integrityFallbackActiveUntil() {
    return integrityFallbackActiveUntil;
  },
  set integrityFallbackActiveUntil(v) {
    integrityFallbackActiveUntil = v;
  },
  get recoveryBackoffUntil() {
    return recoveryBackoffUntil;
  },
  set recoveryBackoffUntil(v) {
    recoveryBackoffUntil = v;
  },
  get lastRecoveryAttemptAt() {
    return lastRecoveryAttemptAt;
  },
  set lastRecoveryAttemptAt(v) {
    lastRecoveryAttemptAt = v;
  },
  get stalledRecoveryAttempts() {
    return stalledRecoveryAttempts;
  },
  set stalledRecoveryAttempts(v) {
    stalledRecoveryAttempts = v;
  },
  get recoveryNotificationSent() {
    return recoveryNotificationSent;
  },
  set recoveryNotificationSent(v) {
    recoveryNotificationSent = v;
  },
  get lastHeartbeatAt() {
    return lastHeartbeatAt;
  },
  set lastHeartbeatAt(v) {
    lastHeartbeatAt = v;
  },
  get lastGamesCacheRefreshAt() {
    return lastGamesCacheRefreshAt;
  },
  set lastGamesCacheRefreshAt(v) {
    lastGamesCacheRefreshAt = v;
  },
};

const notificationController = createNotificationController(state, {
  saveState: () => saveStateExt(state),
});
const sessionOrchestrator = createSessionOrchestrator(state, {
  sanitizeTwitchSession,
  sessionDebugSummary: sessionDebugSummaryExt,
  readTwitchSessionViaExecuteScript: readTwitchSessionViaExecuteScriptExt,
  persistTwitchSession: persistTwitchSessionExt,
  logDebug,
  logWarn,
});
const dropsPageRefresher = createDropsPageRefresher(state, {
  trackActivity,
  ensureStateHydratedForCache,
  waitForTabComplete: waitForTabCompleteExt,
  persistSessionFromDropsPage,
  refreshGamesCacheFromHiddenFetch,
  saveState: () => saveStateExt(state),
  broadcastStateUpdate: broadcastStateUpdateExt,
});
const playbackOrchestrator = createPlaybackOrchestrator(state, {
  ensureContentScriptOnTab,
  ensureManagedTab: ensureManagedTabExt,
  waitForTabComplete: waitForTabCompleteExt,
  shouldMuteManagedFarmingTab: () => shouldMuteManagedFarmingTabExt(state),
  needsPlaybackAttention,
  notify,
  streamerWatchUrl: streamerWatchUrlExt,
});

const GAMES_STALE_THRESHOLD_MS = 60 * 60_000;

async function resetStateForInactivity(trigger: string, idleForMs: number) {
  logInfo('Resetting state after inactivity', {
    trigger,
    idleForMs,
    wasRunning: appState.isRunning,
    wasPaused: appState.isPaused,
  });
  await resetStateForInactivityExt(
    state,
    trigger,
    idleForMs,
    {
      onStopMonitoring: stopMonitoring,
      onClearRotationMetadata: clearRotationMetadata,
      onResetStreamTrackingState: resetStreamTrackingStateExt,
      onSaveTimingState: saveTimingStateExt,
      onBroadcastStateUpdate: broadcastStateUpdateExt,
    },
    {
      createInitialState,
      DROPS_SNAPSHOT_CACHE_KEY,
      LAST_ACTIVITY_AT_KEY,
      TIMING_STATE_KEY,
    },
  );
}

async function enforceInactivityReset(trigger: string): Promise<boolean> {
  const reference = Math.max(lastActivityAt, appState.lastSuccessfulRefreshAt ?? 0);
  if (!reference) {
    await markActivityExt(state, `${trigger}:bootstrap`);
    return false;
  }
  const idleForMs = Date.now() - reference;
  if (idleForMs < INACTIVITY_RESET_MS) {
    return false;
  }
  await resetStateForInactivity(trigger, idleForMs);
  return true;
}

async function trackActivity(reason: string) {
  await enforceInactivityReset(`activity:${reason}`);
  await markActivityExt(state, reason);
}

async function handleExtensionUpdate() {
  // Reset volatile farming state on update while preserving lifetime statistics.
  const lifetimeStats = {
    totalDropsClaimed: appState.totalDropsClaimed,
    totalChannelPointsClaimed: appState.totalChannelPointsClaimed,
  };
  appState = clearRotationMetadata({
    ...createInitialState(),
    ...lifetimeStats,
  });
  cachedDropsSnapshot = [];
  await chrome.storage.local.remove([DROPS_SNAPSHOT_CACHE_KEY, TIMING_STATE_KEY, 'twitchIntegrity']);
  await chrome.storage.session.remove([TIMING_STATE_KEY]).catch(() => undefined);
  await chrome.storage.local.set({ appState, [DROPS_SNAPSHOT_CACHE_KEY]: [] });
  broadcastStateUpdateExt(appState);
}

// Initialize state immediately when the SW module is evaluated. This handles the common
// case where a Chrome alarm wakes the SW from dormancy — neither onStartup nor onInstalled
// fires in that scenario, so without this the appState would remain at its empty defaults.
initPromise = loadState().catch((error) => {
  logWarn('SW initialization failed:', String(error));
});
initPromise = initPromise.then(async () => {
  await notificationController.syncPermissionState();
});

registerExtensionLifecycleListeners({
  alarmName: ALARM_NAME,
  getInitPromise: () => initPromise,
  onExtensionUpdate: handleExtensionUpdate,
  onAlarm: () => checkDropProgress(),
  onManagedTabRemoved: (removedTabId) => handleManagedTabRemoved(removedTabId),
  onManagedTabNavigatedAway: (updatedTabId, url) => handleManagedTabNavigatedAway(updatedTabId, url),
  onMonitorWindowRemoved: (removedWindowId) => handleMonitorWindowRemoved(removedWindowId),
  logWarn,
});

function clearRecoveryState() {
  recoveryBackoffUntil = 0;
  lastRecoveryAttemptAt = 0;
  stalledRecoveryAttempts = 0;
  recoveryNotificationSent = false;
  appState = clearRecoveryStatus(appState);
}

function clearStopState() {
  appState = clearTerminalStopStatus(appState);
}

async function notify(title: string, message: string, priority = 2) {
  await notificationController.notify(title, message, priority);
}

async function stopFarmingSession(options?: {
  notification?: { title: string; message: string };
  stopReason?: string;
  stopMessage?: string | null;
}) {
  await stopFarmingSessionExt(state, {
    ...options,
    onStopMonitoring: stopMonitoring,
    onCloseManagedTab: async (tabId: number | null) => {
      await closeManagedTabIfSafeExt(tabId);
    },
    onClearRotationMetadata: clearRotationMetadata,
    onApplyStopState: applyStopStateExt,
    onNotify: async (title: string, message: string) => {
      await notify(title, message);
    },
    onSaveState: () => saveStateExt(state),
    onSaveTimingState: saveTimingStateExt,
  });
}

async function attemptPlaybackSelfHeal(tabId: number): Promise<void> {
  await playbackOrchestrator.attemptPlaybackSelfHeal(tabId);
}

async function loadState() {
  await loadStateExt(
    state,
    {
      onLoadTimingState: loadTimingStateExt,
      onEnforceInactivityReset: enforceInactivityReset,
    },
    {
      sanitizeTwitchSession,
      sessionDebugSummary: sessionDebugSummaryExt,
      createInitialState,
      clearRotationMetadata,
      TWITCH_SESSION_STORAGE_KEY,
      DROPS_SNAPSHOT_CACHE_KEY,
      LAST_ACTIVITY_AT_KEY,
      TIMING_STATE_KEY,
      STREAM_VALIDATION_GRACE_MS,
    },
  );

  const handledStartupPolicy = await handleStartupResumePolicy();
  if (!handledStartupPolicy && state.appState.isRunning && !state.appState.isPaused) {
    startMonitoring();
  }
}

async function canResumeWithExistingManagedTab(): Promise<boolean> {
  if (!state.appState.tabId) {
    return false;
  }
  const tab = await chrome.tabs.get(state.appState.tabId).catch(() => null);
  return Boolean(tab?.id && getFarmableTwitchChannelNameFromUrl(tab.url));
}

async function handleStartupResumePolicy() {
  const now = Date.now();
  const startupResumePolicy = applyStartupResumePolicy(state, now, CRASH_DETECTION_THRESHOLD_MS);

  if (startupResumePolicy === 'paused-on-startup') {
    logInfo('Long browser restart detected; leaving farming paused', {
      secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
    });
    stopMonitoring();
    await saveStateExt(state);
    await saveTimingStateExt(state);
    return true;
  }

  if (startupResumePolicy === 'auto-resume') {
    const keptExistingTab = await canResumeWithExistingManagedTab();
    logInfo(
      keptExistingTab
        ? 'Long browser restart detected; resuming with existing Twitch tab'
        : 'Long browser restart detected; reopening streamer',
      { secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000) },
    );
    state.appState.resumedFromCrash = now;
    state.lastProgressAdvanceAt = now;
    state.noProgressRotationAttempts = 0;
    state.recoveryBackoffUntil = 0;
    state.stalledRecoveryAttempts = 0;
    state.recoveryNotificationSent = false;
    state.appState = clearRecoveryStatus(state.appState);
    state.streamValidationGraceUntil = now + STREAM_VALIDATION_GRACE_MS;
    if (!keptExistingTab) {
      state.appState.tabId = null;
      state.appState.activeStreamer = null;
    }
    await saveStateExt(state);
    await saveTimingStateExt(state);
    if (!keptExistingTab && state.appState.selectedGame) {
      await openBestStreamerForSelectedGame();
    }
    setTimeout(() => {
      if (state.appState.resumedFromCrash != null) {
        state.appState.resumedFromCrash = null;
        saveStateExt(state).catch(() => undefined);
      }
    }, CRASH_RECOVERY_GRACE_MS);
    startMonitoring();
    return true;
  }

  return false;
}

export const GAMES_CACHE_TTL_MS = 5 * 60_000;

async function ensureStateHydratedForCache() {
  const hasRuntimeState =
    appState.availableGames.length > 0 ||
    appState.queue.length > 0 ||
    Boolean(appState.selectedGame) ||
    appState.isRunning;
  if (hasRuntimeState) {
    return;
  }
  await loadState();
}

async function openMonitorDashboardWindow(options?: { toggle?: boolean }) {
  return openMonitorDashboardWindowController(state, {
    ...options,
    monitorDashboardUrl: monitorDashboardUrlExt,
    applyBestEffortAlwaysOnTop: applyBestEffortAlwaysOnTopExt,
    saveState: () => saveStateExt(state),
  });
}

async function ensureContentScriptOnTab(tabId: number) {
  await sessionOrchestrator.ensureContentScriptOnTab(tabId);
}

async function findTwitchSessionInOpenTabs(): Promise<TwitchSession | null> {
  return sessionOrchestrator.findTwitchSessionInOpenTabs();
}

async function ensureTwitchSession(forceRefresh = false): Promise<TwitchSession | null> {
  return ensureTwitchSessionExt(
    state,
    forceRefresh,
    {
      onFindTwitchSessionInOpenTabs: findTwitchSessionInOpenTabs,
    },
    {
      sanitizeTwitchSession,
      sessionDebugSummary: sessionDebugSummaryExt,
      persistTwitchSession: persistTwitchSessionExt,
      clearTwitchSessionCache: clearTwitchSessionCacheExt,
    },
  );
}

async function persistSessionFromDropsPage(tabId: number): Promise<TwitchSession | null> {
  return sessionOrchestrator.persistSessionFromDropsPage(tabId);
}

function shouldRefreshCampaignsAfterSessionSync(): boolean {
  return sessionOrchestrator.shouldRefreshCampaignsAfterSessionSync(GAMES_STALE_THRESHOLD_MS);
}

async function fetchDropsSnapshotFromApi(forceSessionRefresh = false): Promise<DropsSnapshot | null> {
  return fetchDropsSnapshotFromApiWrapper(
    state,
    forceSessionRefresh,
    {
      onEnsureTwitchSession: ensureTwitchSession,
      onEnsureSessionIntegrity: ensureSessionIntegrityExt,
      onPersistTwitchSession: persistTwitchSessionExt,
      onStopFarmingSession: stopFarmingSession,
      onIsLikelyAuthError: isLikelyAuthError,
      onClearTwitchSessionCache: clearTwitchSessionCacheExt,
    },
    {
      TwitchApiClient,
      sessionDebugSummary: sessionDebugSummaryExt,
      PROGRESS_POLL_MS,
      logDebug,
      logWarn,
      logInfo,
    },
  );
}

async function fetchDirectoryStreamersFromApi(
  game: TwitchGame,
  forceSessionRefresh = false,
  language = '',
): Promise<TwitchStreamer[] & { languageFilterApplied: boolean }> {
  return fetchDirectoryStreamersFromApiWrapper(
    state,
    game,
    forceSessionRefresh,
    language,
    {
      onEnsureTwitchSession: ensureTwitchSession,
      onIsLikelyAuthError: isLikelyAuthError,
      onClearTwitchSessionCache: clearTwitchSessionCacheExt,
    },
    { logWarn },
  );
}

async function fetchStreamContext(tabId: number): Promise<StreamContext | null> {
  const send = async () => chrome.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' });
  const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STREAM_CONTEXT_TIMEOUT_MS)),
    ]);
  let response: { success?: boolean; context?: StreamContext } | null = null;
  try {
    response = await withTimeout(send());
  } catch {
    await ensureContentScriptOnTab(tabId);
    response = await withTimeout(send()).catch(() => null);
  }
  if (!response?.success || !response.context) {
    return null;
  }
  return response.context as StreamContext;
}

async function refreshGamesCacheFromHiddenFetch(
  options: { forceSessionRefresh?: boolean } = {},
): Promise<TwitchGame[]> {
  if (gamesCacheRefreshInFlight) {
    return gamesCacheRefreshInFlight;
  }

  gamesCacheRefreshInFlight = (async () => {
    let fetchedGames: TwitchGame[] = [];
    const apiSnapshot = await fetchDropsSnapshotFromApi(Boolean(options.forceSessionRefresh));
    if (apiSnapshot?.games?.length) {
      fetchedGames = apiSnapshot.games;
      appState.lastSuccessfulRefreshAt = Date.now();
      if (apiSnapshot.drops.length > 0) {
        cachedDropsSnapshot = apiSnapshot.drops;
      }
      if (apiSnapshot.campaignChannelsMap) {
        cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
    }

    const mergedGames =
      fetchedGames.length > 0 ? replaceAvailableGames(fetchedGames) : appState.availableGames;
    const annotatedGames = annotateGameCompletionExt(mergedGames, cachedDropsSnapshot);
    appState.availableGames = annotatedGames;
    normalizeGameSelectionExt(state, annotatedGames);
    normalizeQueueSelectionExt(state, annotatedGames);
    // If we have a selected game and fresh drops, update the drop split
    if (appState.selectedGame && cachedDropsSnapshot.length > 0) {
      splitDropsForSelectedGameExt(state, cachedDropsSnapshot);
    }
    lastGamesCacheRefreshAt = Date.now();
    await saveStateExt(state);
    return mergedGames;
  })().finally(() => {
    gamesCacheRefreshInFlight = null;
  });

  return gamesCacheRefreshInFlight;
}

async function openDropsPageAndRefresh() {
  return dropsPageRefresher.openDropsPageAndRefresh();
}

function evaluateDropsForGame(
  game: TwitchGame,
  drops: TwitchDrop[],
): { allDrops: TwitchDrop[]; pendingDrops: TwitchDrop[]; hasFarmableDrops: boolean } {
  const relevantDrops = drops.filter((drop) => dropMatchesSelectedGameExt(drop, game));
  const allDrops = relevantDrops;
  const pendingDrops = allDrops.filter((drop) => !isDropCompleted(drop));
  const hasFarmableDrops = pendingDrops.some((drop) => drop.dropType !== 'event-based');
  return { allDrops, pendingDrops, hasFarmableDrops };
}

async function resolveCategorySlug(game: TwitchGame): Promise<string> {
  // Prefer availableGames — may have the correct slug from content script
  const updated = appState.availableGames.find(
    (item) => item.id === game.id || sameCampaignId(item.campaignId, game.campaignId),
  );
  if (updated?.categorySlug) {
    return updated.categorySlug;
  }

  if (game.categorySlug) {
    return game.categorySlug;
  }

  return toSlug(game.name);
}

async function openForegroundChannel(streamer: TwitchStreamer) {
  await playbackOrchestrator.openForegroundChannel(streamer);
}

async function enforcePlaybackPolicyOnStreamTab() {
  await playbackOrchestrator.enforcePlaybackPolicyOnStreamTab();
}

async function sendAlert(kind: 'drop-complete' | 'all-complete', message: string) {
  await notify(kind === 'all-complete' ? 'All drops completed' : 'Drop completed', message);

  const tabs = await chrome.tabs.query({ url: ['https://www.twitch.tv/*', 'https://twitch.tv/*'] });
  await Promise.all(
    tabs
      .filter((tab) => Boolean(tab.id))
      .map((tab) =>
        chrome.tabs
          .sendMessage(tab.id as number, {
            type: 'PLAY_ALERT',
            payload: { kind, message },
          })
          .catch(() => undefined),
      ),
  );
}

async function evaluateDropTransitions(previousCompletedIds: Set<string>) {
  const nowCompleted = new Set(appState.completedDrops.map((drop) => drop.id));
  const newlyCompleted = appState.completedDrops.filter((drop) => !previousCompletedIds.has(drop.id));
  const newlyClaimed = newlyCompleted.filter((drop) => drop.claimed);

  if (newlyClaimed.length > 0) {
    appState.totalDropsClaimed += newlyClaimed.length;
  }

  for (const drop of newlyCompleted) {
    await sendAlert('drop-complete', `Reward unlocked: ${drop.name}`);
  }

  const hasDrops = appState.allDrops.length > 0;
  const allCompleted = hasDrops && appState.pendingDrops.length === 0 && appState.currentDrop === null;
  if (allCompleted && !appState.completionNotified) {
    await sendAlert(
      'all-complete',
      `All rewards for ${appState.selectedGame ? getGameDisplayLabel(appState.selectedGame) : 'this campaign'} are complete.`,
    );
    appState.completionNotified = true;
  }

  if (nowCompleted.size < previousCompletedIds.size) {
    appState.completionNotified = false;
  }
}

async function autoClaimClaimableDrops(): Promise<boolean> {
  return autoClaimClaimableDropsExt(
    state,
    (force) => ensureTwitchSession(force),
    async (drop) => {
      await sendAlert('drop-complete', `Claimed: ${drop.name} (${drop.gameName})`);
    },
  );
}

export interface RefreshDropsOptions {
  includeCampaignFetch?: boolean;
  includeInventoryFetch?: boolean;
  forceInventoryFetch?: boolean;
  suppressNotifications?: boolean;
}

async function refreshDropsData(options: RefreshDropsOptions = {}) {
  await refreshDropsDataExt(
    state,
    options,
    {
      onFetchDropsSnapshotFromApi: fetchDropsSnapshotFromApi,
      onEvaluateDropTransitions: evaluateDropTransitions,
      onSaveState: saveStateExt,
    },
    {
      replaceAvailableGames,
      getGameDisplayLabel,
      updateStateFromSnapshot: updateStateFromSnapshotExt,
      normalizeQueueSelection: normalizeQueueSelectionExt,
    },
  );
}

async function checkDropProgress() {
  // Ensure SW initialization has completed before processing any alarm tick.
  if (initPromise) {
    await initPromise;
  }

  await checkDropProgressExt(state, {
    onEnforcePlaybackPolicy: enforcePlaybackPolicyOnStreamTab,
    onRotateStreamerIfInvalid: rotateStreamerIfInvalid,
    onAttemptAutoClaimChannelPointsBonus: attemptAutoClaimChannelPointsBonus,
    onRefreshDropsData: refreshDropsData,
    onAutoClaimClaimableDrops: autoClaimClaimableDrops,
    onAdvanceQueueIfCompleted: advanceQueueIfCompleted,
    onSaveTimingState: saveTimingStateExt,
  });
}

function startMonitoring() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: PROGRESS_POLL_MS / 60_000 });
  checkDropProgress().catch((error) => logWarn('Initial monitoring error:', String(error)));
}

function stopMonitoring() {
  chrome.alarms.clear(ALARM_NAME).catch(() => undefined);
}

async function openBestStreamerForSelectedGame(): Promise<boolean> {
  return openBestStreamerForSelectedGameExt(
    state,
    {
      onFetchDirectoryStreamersFromApi: fetchDirectoryStreamersFromApi,
      onOpenForegroundChannel: openForegroundChannel,
    },
    {
      dropMatchesSelectedGame: dropMatchesSelectedGameExt,
      isDropCompleted,
      getGameDisplayLabel,
      resolveCategorySlug,
      pickStreamerForPreferences,
      normalizePreferredStreamerLanguage,
    },
  );
}

async function ensureWorkspaceForSelectedGame() {
  if (!appState.selectedGame) {
    return;
  }
  const resolvedSlug = await resolveCategorySlug(appState.selectedGame);
  appState.selectedGame = {
    ...appState.selectedGame,
    categorySlug: resolvedSlug,
  };
}

async function advanceQueueIfCompleted(): Promise<boolean> {
  return advanceQueueIfCompletedExt(state, {
    onOpenStreamer: openBestStreamerForSelectedGame,
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onSendAlert: sendAlert,
    onStopMonitoring: stopMonitoring,
    onCloseManagedTabIfSafe: closeManagedTabIfSafeExt,
    onClearManagedTabOwnership: () => clearManagedTabOwnershipExt(state),
    onApplyStopState: applyStopStateExt,
    onRefreshDropsData: refreshDropsData,
    onSaveState: () => saveStateExt(state),
    onSaveTimingState: saveTimingStateExt,
  });
}

async function handleStartFarming(payload: { game?: TwitchGame }) {
  const result = await handleStartFarmingExt(state, payload, {
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onRefreshDropsData: refreshDropsData,
    onSaveState: () => saveStateExt(state),
    onSaveTimingState: saveTimingStateExt,
    onBroadcastStateUpdate: () => broadcastStateUpdateExt(appState),
    onStopMonitoring: stopMonitoring,
    onTrackActivity: trackActivity,
    onApplyStopState: applyStopStateExt,
  });

  if (!result.success) {
    return result;
  }

  const advanced = await advanceQueueIfCompleted();
  if (!advanced) {
    return { success: false, error: 'Queue completed. No pending rewards left.' };
  }
  if (!appState.tabId && appState.selectedGame) {
    await openBestStreamerForSelectedGame();
  }
  if (appState.monitorAutoOpen) {
    await new Promise((resolve) => setTimeout(resolve, MONITOR_AUTO_OPEN_DELAY_MS));
    await openMonitorDashboardWindow({ toggle: false }).catch(() => undefined);
  }

  await saveStateExt(state);
  await saveTimingStateExt(state);
  startMonitoring();
  return { success: true };
}

async function skipCurrentGameDueToOfflineRecovery() {
  await skipCurrentGameDueToStallExt(state, {
    onEnsureWorkspace: ensureWorkspaceForSelectedGame,
    onRefreshDropsData: refreshDropsData,
    onOpenStreamer: openBestStreamerForSelectedGame,
    onSaveState: () => saveStateExt(state),
    onSaveTimingState: saveTimingStateExt,
    onStopFarmingSession: stopFarmingSession,
  });
}

async function rotateStreamerIfInvalid() {
  await rotateStreamerIfInvalidExt(state, {
    onFetchStreamContext: fetchStreamContext,
    onResolveCategorySlug: resolveCategorySlug,
    onAttemptPlaybackSelfHeal: attemptPlaybackSelfHeal,
    onSaveState: () => saveStateExt(state),
    onSaveTimingState: saveTimingStateExt,
    onRotateStreamer: rotateStreamerExt,
    onOpenStreamer: openBestStreamerForSelectedGame,
    onEnterPersistentRecovery: enterPersistentRecoveryExt,
    onSkipCurrentGame: skipCurrentGameDueToOfflineRecovery,
  });
}

async function handleStopFarming() {
  await trackActivity('stop-farming');
  await stopFarmingSession({
    stopReason: 'user-stop',
    stopMessage: 'Stopped by user.',
  });
  return { success: true };
}

async function handleSetSelectedGame(payload: { game: TwitchGame }) {
  return handleSetSelectedGameExt(
    state,
    payload,
    {
      onTrackActivity: trackActivity,
      onEnsureWorkspace: ensureWorkspaceForSelectedGame,
      onRefreshDropsData: refreshDropsData,
      onOpenBestStreamer: openBestStreamerForSelectedGame,
      onSaveState: saveStateExt,
      onSaveTimingState: saveTimingStateExt,
    },
    {
      resolveGameFromState: resolveGameFromStateExt,
      removeGameFromQueue: removeGameFromQueueExt,
      splitDropsForSelectedGame: splitDropsForSelectedGameExt,
      getGameDisplayLabel,
      logDebug,
      logWarn,
    },
  );
}

async function handleAddToQueue(payload: { game?: TwitchGame }) {
  return handleAddToQueueExt(
    state,
    payload,
    { onTrackActivity: trackActivity, onSaveState: saveStateExt },
    { resolveGameFromState: resolveGameFromStateExt, evaluateDropsForGame, getGameDisplayLabel },
  );
}

async function handleRemoveFromQueue(payload: { game?: TwitchGame; gameId?: string; campaignId?: string }) {
  return handleRemoveFromQueueExt(
    state,
    payload,
    { onTrackActivity: trackActivity, onSaveState: saveStateExt },
    { removeGameFromQueue: removeGameFromQueueExt, sameCampaignId },
  );
}

async function handleClearQueue() {
  await trackActivity('clear-queue');
  appState.queue = [];
  await saveStateExt(state);
  return { success: true, queueLength: 0 };
}

async function handleEnsureGamesCache(payload?: { force?: boolean }) {
  await trackActivity('ensure-games-cache');
  await ensureStateHydratedForCache();
  const force = Boolean(payload?.force);
  const shouldRefresh = shouldRefreshGamesCacheExt(state, force);
  if (shouldRefresh) {
    await refreshGamesCacheFromHiddenFetch();
  } else if (cachedDropsSnapshot.length > 0) {
    // Cache is fresh — no API call needed. But the games persisted in storage may
    // pre-date the annotation logic (e.g. after an extension update or SW restart).
    // Re-annotate in-memory and persist so the popup reads correct allDropsCompleted flags.
    appState.availableGames = annotateGameCompletionExt(appState.availableGames, cachedDropsSnapshot);
    await saveStateExt(state);
  }
  return {
    success: true,
    refreshed: shouldRefresh,
    gamesCount: appState.availableGames.length,
    games: appState.availableGames,
  };
}

async function handlePauseFarming() {
  await trackActivity('pause-farming');
  appState.isPaused = true;
  playbackAttentionWarningSent = false;
  stopMonitoring();
  await saveStateExt(state);
  await saveTimingStateExt(state);
  return { success: true };
}

async function handleResumeFarming() {
  await trackActivity('resume-farming');
  appState.isPaused = false;
  invalidStreamChecks = 0;
  noProgressRotationAttempts = 0;
  clearStopState();
  // Re-issue grace window so the first tick after resume doesn't immediately run
  // full rotation validation against a stream that hasn't had time to respond.
  if (appState.tabId) {
    streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
  }
  clearRecoveryState();
  startMonitoring();
  await saveStateExt(state);
  await saveTimingStateExt(state);
  return { success: true };
}

async function handleRefreshDrops() {
  await trackActivity('refresh-drops');
  await refreshDropsData({
    includeCampaignFetch: true,
    includeInventoryFetch: Boolean(appState.selectedGame),
    forceInventoryFetch: true,
  });
  return { success: true };
}

async function handleSetMonitorAutoOpen(payload?: { enabled?: boolean }) {
  await trackActivity('set-monitor-auto-open');
  appState.monitorAutoOpen = payload?.enabled !== false;
  await saveStateExt(state);
  return { success: true, monitorAutoOpen: appState.monitorAutoOpen };
}

async function handleSetAutoResumeOnStartup(payload?: { enabled?: boolean }) {
  if (initPromise) {
    await initPromise;
  }
  await trackActivity('set-auto-resume-on-startup');
  appState.autoResumeOnStartup = payload?.enabled === true;
  await saveStateExt(state);
  return { success: true, autoResumeOnStartup: appState.autoResumeOnStartup };
}

async function handleSetMuteFarmingTab(payload?: { enabled?: boolean }) {
  await trackActivity('set-mute-farming-tab');
  appState.muteFarmingTab = payload?.enabled !== false;
  await Promise.all([saveStateExt(state), syncManagedTabMuteStateExt(state)]);
  return { success: true, muteFarmingTab: appState.muteFarmingTab };
}

async function handleSetNotificationsEnabled(payload?: { enabled?: boolean }) {
  await trackActivity('set-notifications-enabled');
  const enabled = payload?.enabled !== false;
  if (!enabled) {
    appState.notificationsEnabled = false;
    await saveStateExt(state);
    return { success: true, notificationsEnabled: appState.notificationsEnabled };
  }

  if (!(await notificationController.hasNotificationPermission())) {
    appState.notificationsEnabled = false;
    await saveStateExt(state);
    return {
      success: false,
      notificationsEnabled: appState.notificationsEnabled,
      error: 'Notification permission was not granted',
    };
  }

  appState.notificationsEnabled = true;
  await saveStateExt(state);
  return { success: true, notificationsEnabled: appState.notificationsEnabled };
}

async function handleSetAutoClaimChannelPointsBonus(payload?: { enabled?: boolean }) {
  await trackActivity('set-auto-claim-channel-points-bonus');
  appState = applyAutoClaimChannelPointsBonusSetting(appState, payload?.enabled);
  await saveStateExt(state);
  return {
    success: true,
    autoClaimChannelPointsBonus: appState.autoClaimChannelPointsBonus,
  };
}

async function handleSetAutoClaimDrops(payload?: { enabled?: boolean }) {
  await trackActivity('set-auto-claim-drops');
  appState = applyAutoClaimDropsSetting(appState, payload?.enabled);
  await saveStateExt(state);
  return {
    success: true,
    autoClaimDrops: appState.autoClaimDrops,
  };
}

async function handleSetStreamerSelectionMode(payload?: { mode?: 'low-view' | 'random' | 'top-viewers' }) {
  await trackActivity('set-streamer-selection-mode');
  appState = applyStreamerSelectionModeSetting(appState, payload?.mode);
  await saveStateExt(state);
  return {
    success: true,
    streamerSelectionMode: appState.streamerSelectionMode,
  };
}

async function handleSetPreferredStreamerLanguage(payload?: { language?: string | null }) {
  await trackActivity('set-preferred-streamer-language');
  appState = applyPreferredStreamerLanguageSetting(appState, payload?.language);
  await saveStateExt(state);
  return {
    success: true,
    preferredStreamerLanguage: appState.preferredStreamerLanguage,
  };
}

async function attemptAutoClaimChannelPointsBonus() {
  if (!shouldAttemptAutoClaimChannelPointsBonus(appState)) {
    return false;
  }

  const tabId = appState.tabId;
  if (tabId == null) {
    return false;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) {
    return false;
  }

  await ensureContentScriptOnTab(tab.id);
  const result = (await chrome.tabs
    .sendMessage(tab.id, {
      type: 'CLAIM_CHANNEL_POINTS_BONUS',
    })
    .catch(() => null)) as ChannelPointsBonusClaimResponse | null;

  if (result?.success && result.claimed) {
    const channelName = getChannelNameFromTab(tab.url) ?? appState.activeStreamer?.displayName ?? null;
    logDebug('Auto-claimed channel points bonus', { tabId: tab.id, channelName });
    await recordChannelPointsBonusClaimed(channelName);
    return true;
  }

  return false;
}

async function ensureInitializedForStatsUpdate() {
  if (initPromise) {
    await initPromise;
  }
}

function getChannelNameFromTab(url: string | undefined): string | null {
  return getFarmableTwitchChannelNameFromUrl(url);
}

async function recordChannelPointsBonusClaimed(channelName?: string | null) {
  await ensureInitializedForStatsUpdate();
  appState.totalChannelPointsClaimed = appState.totalChannelPointsClaimed + 1;
  await saveStateExt(state);
  const fromChannel = channelName ? ` from ${channelName}` : '';
  await notify('Channel points claimed', `Claimed${fromChannel}.`, 0);
}

async function handleUpdateGames(payload?: TwitchGame[]) {
  appState.availableGames = replaceAvailableGames(payload ?? []);
  appState.availableGames = annotateGameCompletionExt(appState.availableGames, cachedDropsSnapshot);
  if (appState.availableGames.length > 0) {
    appState.lastSuccessfulRefreshAt = Date.now();
  }
  normalizeGameSelectionExt(state, appState.availableGames, true);
  normalizeQueueSelectionExt(state, appState.availableGames, true);
  await saveStateExt(state);
  saveTimingStateExt(state).catch(() => undefined);
  return { success: true };
}

function sessionPayloadCandidate(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'session' in payload) {
    return (payload as { session?: unknown }).session;
  }
  return payload;
}

async function handleSyncTwitchSession(payload: unknown, sender: chrome.runtime.MessageSender) {
  const incoming = sanitizeTwitchSession(sessionPayloadCandidate(payload));
  if (!incoming) {
    return { success: false, error: 'Invalid session payload' };
  }
  twitchSessionCache = incoming;
  twitchSessionLastAttemptAt = 0;
  await persistTwitchSessionExt(incoming);
  logDebug('Twitch session synced from content script', sessionDebugSummaryExt(incoming));
  if (sender.tab?.id && shouldRefreshCampaignsAfterSessionSync()) {
    await refreshGamesCacheFromHiddenFetch();
    await saveStateExt(state);
    broadcastStateUpdateExt(appState);
  }
  return { success: true };
}

async function handleSyncTwitchIntegrity(payload?: {
  token?: string;
  expiration?: number;
  request_id?: string;
}) {
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
  if (!token) {
    return { success: false, error: 'Empty integrity token' };
  }
  const expiration = typeof payload?.expiration === 'number' ? payload.expiration : 0;
  logDebug('Integrity token synced from content script', {
    hasToken: true,
    expiration,
    hasSession: Boolean(twitchSessionCache),
  });
  // A fresh page-intercepted token means integrity is working — reset the fallback flag
  // so the next request re-attempts with integrity instead of staying in no-integrity mode.
  integrityFallbackActive = false;
  integrityFallbackActiveUntil = 0;
  if (twitchSessionCache) {
    twitchSessionCache = { ...twitchSessionCache, clientIntegrity: token };
    persistTwitchSessionExt(twitchSessionCache).catch(() => undefined);
  }
  // Also store the full integrity object separately for expiration tracking.
  chrome.storage.local
    .set({ twitchIntegrity: { token, expiration, request_id: payload?.request_id || '' } })
    .catch(() => undefined);
  return { success: true };
}

async function handleChannelPointsBonusClaimed(
  payload: { channelName?: string | null } | undefined,
  sender: chrome.runtime.MessageSender,
) {
  logDebug('Channel points bonus claimed by content script', { tabId: sender.tab?.id });
  await recordChannelPointsBonusClaimed(payload?.channelName ?? getChannelNameFromTab(sender.tab?.url));
  return { success: true };
}

registerRuntimeMessageRouter({
  ensureGamesCache: (message) => handleEnsureGamesCache(message.payload),
  openDropsPageAndRefresh: () => openDropsPageAndRefresh(),
  addToQueue: (message) => handleAddToQueue(message.payload),
  removeFromQueue: (message) => handleRemoveFromQueue(message.payload),
  clearQueue: () => handleClearQueue(),
  startFarming: (message) => handleStartFarming(message.payload),
  setSelectedGame: (message) => handleSetSelectedGame(message.payload),
  pauseFarming: () => handlePauseFarming(),
  setAutoResumeOnStartup: (message) => handleSetAutoResumeOnStartup(message.payload),
  resumeFarming: () => handleResumeFarming(),
  stopFarming: () => handleStopFarming(),
  updateGames: (message) => handleUpdateGames(message.payload),
  syncTwitchSession: (message, sender) => handleSyncTwitchSession(message.payload, sender),
  syncTwitchIntegrity: (message) => handleSyncTwitchIntegrity(message.payload),
  refreshDrops: () => handleRefreshDrops(),
  setMonitorAutoOpen: (message) => handleSetMonitorAutoOpen(message.payload),
  setMuteFarmingTab: (message) => handleSetMuteFarmingTab(message.payload),
  setNotificationsEnabled: (message) => handleSetNotificationsEnabled(message.payload),
  setAutoClaimChannelPointsBonus: (message) => handleSetAutoClaimChannelPointsBonus(message.payload),
  channelPointsBonusClaimed: (message, sender) => handleChannelPointsBonusClaimed(message.payload, sender),
  setAutoClaimDrops: (message) => handleSetAutoClaimDrops(message.payload),
  setStreamerSelectionMode: (message) => handleSetStreamerSelectionMode(message.payload),
  setPreferredStreamerLanguage: (message) => handleSetPreferredStreamerLanguage(message.payload),
  openMonitorDashboard: (message) => openMonitorDashboardWindow(message.payload ?? {}),
});

async function handleManagedTabRemoved(removedTabId: number) {
  if (appState.tabId === removedTabId) {
    clearManagedTabOwnershipExt(state);
    await saveStateExt(state);
  }
}

// Detect when the managed farming tab navigates away from Twitch
async function handleManagedTabNavigatedAway(updatedTabId: number, url: string) {
  if (updatedTabId !== appState.tabId) {
    return;
  }
  logInfo('Managed tab navigated away from Twitch (onUpdated)', { url });
  // Release the tab so next rotation creates a new tab instead of hijacking this one.
  clearManagedTabOwnershipExt(state);
  invalidStreamChecks = INVALID_STREAM_THRESHOLD;
  await saveStateExt(state);
}

async function handleMonitorWindowRemoved(removedWindowId: number) {
  if (appState.monitorWindowId === removedWindowId) {
    appState.monitorWindowId = null;
    await saveStateExt(state);
  }
}

logDebug('DropHunter service worker loaded');
