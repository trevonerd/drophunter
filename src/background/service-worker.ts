import { isDropCompleted } from '../shared/drops';
import { getGameDisplayLabel, replaceAvailableGames } from '../shared/game-selection';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../shared/runtime-status';
import { createInitialState, toSlug } from '../shared/utils';
import type { PlaybackPrepResult } from '../types';
import { AppState, DropsSnapshot, Message, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
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
import { needsPlaybackAttention } from './playback.ts';
import { clearRotationMetadata } from './runtime-state';
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

const TWITCH_DROPS_PAGE_URL = 'https://www.twitch.tv/drops/campaigns';
const GAMES_STALE_THRESHOLD_MS = 60 * 60_000;
let dropsPageRefreshInFlight: Promise<{
  success: boolean;
  opened: boolean;
  refreshed: boolean;
  gamesCount: number;
  error?: string;
}> | null = null;

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

chrome.runtime.onStartup.addListener(async () => {
  try {
    // State is already loading via the module-level initPromise — just await it.
    if (initPromise) await initPromise;
  } catch (error) {
    logWarn('onStartup error:', String(error));
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    // Ensure module initialization has settled before potentially resetting state.
    if (initPromise) await initPromise;
    if (details.reason === 'update') {
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
  } catch (error) {
    logWarn('onInstalled error:', String(error));
  }
  // Fresh install: loadState() already ran at module evaluation time.
});

// Initialize state immediately when the SW module is evaluated. This handles the common
// case where a Chrome alarm wakes the SW from dormancy — neither onStartup nor onInstalled
// fires in that scenario, so without this the appState would remain at its empty defaults.
initPromise = loadState().catch((error) => {
  logWarn('SW initialization failed:', String(error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkDropProgress().catch((error) => logWarn('Monitoring error:', String(error)));
  }
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
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority,
  });
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
  playbackAttentionWarningSent = false;
  // Do NOT focus/activate the tab here — self-heal targets the same already-open streamer.
  // Forcing focus would steal window focus from the user even though no streamer change is
  // happening. Focus is only appropriate when opening a new streamer (openForegroundChannel).
  const prepared = await prepareStreamPlayback(tabId, {
    unmuteTab: true,
    muteAfterPrep: shouldMuteManagedFarmingTabExt(state),
  });
  if (prepared?.gateDismissed) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const retried = await prepareStreamPlayback(tabId, {
      unmuteTab: true,
      muteAfterPrep: shouldMuteManagedFarmingTabExt(state),
    });
    if (needsPlaybackAttention(retried)) {
      await sendPlaybackAttentionWarning();
    }
    return;
  }
  if (needsPlaybackAttention(prepared)) {
    await sendPlaybackAttentionWarning();
  }
}

async function loadState() {
  await loadStateExt(
    state,
    {
      onLoadTimingState: loadTimingStateExt,
      onEnforceInactivityReset: enforceInactivityReset,
      onStartMonitoring: startMonitoring,
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

  const isCrashRecovery =
    state.appState.isRunning &&
    !state.appState.isPaused &&
    state.lastHeartbeatAt > 0 &&
    Date.now() - state.lastHeartbeatAt > CRASH_DETECTION_THRESHOLD_MS;

  if (isCrashRecovery) {
    logInfo('Crash recovery detected', {
      secondsAgo: Math.round((Date.now() - state.lastHeartbeatAt) / 1000),
    });
    state.appState.resumedFromCrash = Date.now();
    state.appState.tabId = null;
    state.appState.activeStreamer = null;
    state.lastProgressAdvanceAt = Date.now();
    state.noProgressRotationAttempts = 0;
    state.recoveryBackoffUntil = 0;
    state.stalledRecoveryAttempts = 0;
    state.recoveryNotificationSent = false;
    state.appState = clearRecoveryStatus(state.appState);
    state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    await saveStateExt(state);
    await saveTimingStateExt(state);
    if (state.appState.selectedGame) {
      await openBestStreamerForSelectedGame();
    }
    setTimeout(() => {
      if (state.appState.resumedFromCrash != null) {
        state.appState.resumedFromCrash = null;
        saveStateExt(state).catch(() => undefined);
      }
    }, CRASH_RECOVERY_GRACE_MS);
  }
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
  const url = monitorDashboardUrlExt();
  if (appState.monitorWindowId) {
    const existingWindow = await chrome.windows.get(appState.monitorWindowId).catch(() => null);
    if (existingWindow?.id) {
      if (options?.toggle) {
        await chrome.windows.remove(existingWindow.id).catch(() => undefined);
        appState.monitorWindowId = null;
        await saveStateExt(state);
        return { success: true, opened: false };
      }
      await applyBestEffortAlwaysOnTopExt(existingWindow.id);
      return { success: true, opened: true };
    }
    appState.monitorWindowId = null;
  }

  const createdWindow = await chrome.windows
    .create({
      url,
      type: 'popup',
      width: 360,
      height: 220,
      focused: true,
    })
    .catch(() => null);
  if (!createdWindow?.id) {
    return { success: false, error: 'Unable to open monitor window.' };
  }

  appState.monitorWindowId = createdWindow.id;
  await applyBestEffortAlwaysOnTopExt(createdWindow.id);
  await saveStateExt(state);
  return { success: true, opened: true };
}

async function ensureContentScriptOnTab(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (error) {
    // Content script may already be injected or the tab may not allow scripting — this is expected.
    logDebug('Content script injection skipped', { tabId, reason: String(error) });
  }
}

async function readTwitchSessionFromTab(tabId: number): Promise<TwitchSession | null> {
  const send = async () => chrome.tabs.sendMessage(tabId, { type: 'GET_TWITCH_SESSION' });
  let response: { success?: boolean; session?: unknown } | null = null;
  try {
    response = await send();
  } catch (error) {
    logWarn('GET_TWITCH_SESSION send failed on first attempt', { tabId, error: String(error) });
    await ensureContentScriptOnTab(tabId);
    response = await send().catch((secondError) => {
      logWarn('GET_TWITCH_SESSION send failed after injection', { tabId, error: String(secondError) });
      return null;
    });
  }

  if (!response?.success) {
    logWarn('GET_TWITCH_SESSION failed on tab', { tabId });
    return readTwitchSessionViaExecuteScriptExt(tabId);
  }

  const session = sanitizeTwitchSession(response.session as unknown);
  if (!session) {
    logWarn('Received invalid Twitch session payload from tab', { tabId });
    return readTwitchSessionViaExecuteScriptExt(tabId);
  }
  logDebug('Extracted Twitch session from tab', { tabId, ...sessionDebugSummaryExt(session) });
  return session;
}

async function findTwitchSessionInOpenTabs(): Promise<TwitchSession | null> {
  const tabs = await chrome.tabs.query({
    url: ['https://www.twitch.tv/*', 'https://twitch.tv/*', 'https://player.twitch.tv/*'],
  });

  const sortedTabs = tabs.slice().sort((left, right) => {
    const leftUrl = left.url ?? '';
    const rightUrl = right.url ?? '';
    const leftIsMain = leftUrl.includes('://www.twitch.tv/') || leftUrl.includes('://twitch.tv/');
    const rightIsMain = rightUrl.includes('://www.twitch.tv/') || rightUrl.includes('://twitch.tv/');
    if (leftIsMain !== rightIsMain) {
      return leftIsMain ? -1 : 1;
    }
    if (Boolean(left.active) !== Boolean(right.active)) {
      return left.active ? -1 : 1;
    }
    return 0;
  });

  for (const tab of sortedTabs) {
    if (!tab.id) {
      continue;
    }
    logDebug('Trying Twitch session extraction from tab', {
      tabId: tab.id,
      url: tab.url ?? null,
      active: Boolean(tab.active),
    });
    const session = await readTwitchSessionFromTab(tab.id).catch(() => null);
    if (session) {
      return session;
    }
  }
  return null;
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
  await ensureContentScriptOnTab(tabId);
  const session = await readTwitchSessionFromTab(tabId).catch(() => null);
  if (!session) {
    return null;
  }
  twitchSessionCache = session;
  twitchSessionLastAttemptAt = 0;
  await persistTwitchSessionExt(session);
  return session;
}

function shouldRefreshCampaignsAfterSessionSync(): boolean {
  return (
    appState.availableGames.length === 0 ||
    Date.now() - (appState.lastSuccessfulRefreshAt ?? 0) > GAMES_STALE_THRESHOLD_MS
  );
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

async function findOrOpenDropsPageTab(): Promise<{ tabId: number | null; opened: boolean }> {
  const existingTabs = await chrome.tabs
    .query({ url: ['https://www.twitch.tv/drops/campaigns*', 'https://twitch.tv/drops/campaigns*'] })
    .catch(() => []);
  const existing = existingTabs.find((tab) => typeof tab.id === 'number');
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true }).catch(() => undefined);
    return { tabId: existing.id, opened: false };
  }

  const created = await chrome.tabs.create({ url: TWITCH_DROPS_PAGE_URL, active: true }).catch(() => null);
  return { tabId: created?.id ?? null, opened: true };
}

async function openDropsPageAndRefresh() {
  if (dropsPageRefreshInFlight) {
    return dropsPageRefreshInFlight;
  }

  dropsPageRefreshInFlight = (async () => {
    await trackActivity('open-drops-page-and-refresh');
    await ensureStateHydratedForCache();

    const { tabId, opened } = await findOrOpenDropsPageTab();
    if (!tabId) {
      return {
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: appState.availableGames.length,
        error: 'Unable to open the Twitch Drops page.',
      };
    }

    await waitForTabCompleteExt(tabId);
    const sessionFromTab = await persistSessionFromDropsPage(tabId);
    await refreshGamesCacheFromHiddenFetch({ forceSessionRefresh: !sessionFromTab });
    await saveStateExt(state);
    broadcastStateUpdateExt(appState);

    const gamesCount = appState.availableGames.length;
    return {
      success: gamesCount > 0,
      opened,
      refreshed: true,
      gamesCount,
      error:
        gamesCount > 0
          ? undefined
          : sessionFromTab
            ? 'No active Twitch Drops campaigns were detected.'
            : 'Open Twitch and sign in so DropHunter can detect your session.',
    };
  })().finally(() => {
    dropsPageRefreshInFlight = null;
  });

  return dropsPageRefreshInFlight;
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

async function focusManagedTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) {
    return;
  }
  if (typeof tab.windowId === 'number') {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
}

async function sendPlaybackAttentionWarning() {
  if (playbackAttentionWarningSent) {
    return;
  }
  playbackAttentionWarningSent = true;
  await notify(
    'DropHunter needs your attention',
    "Keep Twitch in front and click the video if playback didn't start.",
    2,
  );
}

async function prepareStreamPlayback(
  tabId: number,
  options?: { activateTab?: boolean; unmuteTab?: boolean; muteAfterPrep?: boolean },
): Promise<PlaybackPrepResult> {
  await ensureContentScriptOnTab(tabId);
  const tabUpdate: chrome.tabs.UpdateProperties = {};
  if (options?.activateTab) {
    tabUpdate.active = true;
  }
  if (options?.unmuteTab !== false) {
    tabUpdate.muted = false;
  }
  if (Object.keys(tabUpdate).length > 0) {
    await chrome.tabs.update(tabId, tabUpdate).catch(() => undefined);
  }
  const prepared = await chrome.tabs
    .sendMessage(tabId, {
      type: 'PREPARE_STREAM_PLAYBACK',
    })
    .catch(() => null);
  if (options?.muteAfterPrep) {
    await chrome.tabs.update(tabId, { muted: true }).catch(() => undefined);
  }
  return (prepared ?? {}) as PlaybackPrepResult;
}

async function openForegroundChannel(streamer: TwitchStreamer) {
  const channelName = streamer.name.toLowerCase();
  const displayName = streamer.displayName || channelName;
  const targetUrl = streamerWatchUrlExt(channelName);
  const isStreamerChange = !appState.activeStreamer || appState.activeStreamer.name !== channelName;
  const managedTabId = await ensureManagedTabExt(appState.tabId, targetUrl, isStreamerChange);
  if (!managedTabId) {
    return;
  }

  const prepareVisiblePlayback = async () => {
    playbackAttentionWarningSent = false;
    if (isStreamerChange) {
      await focusManagedTab(managedTabId);
    }
    await waitForTabCompleteExt(managedTabId, 15_000).catch(() => undefined);
    const prepared = await prepareStreamPlayback(managedTabId, {
      activateTab: isStreamerChange,
      unmuteTab: true,
      muteAfterPrep: shouldMuteManagedFarmingTabExt(state),
    });
    if (prepared?.gateDismissed) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const retried = await prepareStreamPlayback(managedTabId, {
        muteAfterPrep: shouldMuteManagedFarmingTabExt(state),
      });
      if (needsPlaybackAttention(retried)) {
        await sendPlaybackAttentionWarning();
      }
      return;
    }
    if (needsPlaybackAttention(prepared)) {
      await sendPlaybackAttentionWarning();
    }
  };

  void prepareVisiblePlayback().catch(() => undefined);
  appState.tabId = managedTabId;
  appState.activeStreamer = {
    id: channelName,
    name: channelName,
    displayName,
    isLive: true,
    viewerCount: streamer.viewerCount,
  };
  invalidStreamChecks = 0;
  streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
}

async function enforcePlaybackPolicyOnStreamTab() {
  if (!appState.tabId) {
    return;
  }
  // Only enforce playback policy during the initial grace period after opening a stream.
  // After that the stream should be playing fine and repeated enforcement causes unnecessary tab disruption.
  if (Date.now() >= streamValidationGraceUntil) {
    return;
  }
  const tab = await chrome.tabs.get(appState.tabId).catch(() => null);
  if (!tab?.id) {
    return;
  }
  const prepared = await prepareStreamPlayback(tab.id, {
    muteAfterPrep: shouldMuteManagedFarmingTabExt(state),
  });
  if (prepared?.gateDismissed) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const retried = await prepareStreamPlayback(tab.id, {
      muteAfterPrep: shouldMuteManagedFarmingTabExt(state),
    });
    if (needsPlaybackAttention(retried)) {
      await sendPlaybackAttentionWarning();
    }
    return;
  }
  if (needsPlaybackAttention(prepared)) {
    await sendPlaybackAttentionWarning();
  }
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

async function handleSetMuteFarmingTab(payload?: { enabled?: boolean }) {
  await trackActivity('set-mute-farming-tab');
  appState.muteFarmingTab = payload?.enabled !== false;
  await Promise.all([saveStateExt(state), syncManagedTabMuteStateExt(state)]);
  return { success: true, muteFarmingTab: appState.muteFarmingTab };
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
    logDebug('Auto-claimed channel points bonus', { tabId: tab.id });
    await recordChannelPointsBonusClaimed();
    return true;
  }

  return false;
}

async function ensureInitializedForStatsUpdate() {
  if (initPromise) {
    await initPromise;
  }
}

async function recordChannelPointsBonusClaimed() {
  await ensureInitializedForStatsUpdate();
  appState.totalChannelPointsClaimed = appState.totalChannelPointsClaimed + 1;
  await saveStateExt(state);
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.type) {
    case 'ENSURE_GAMES_CACHE':
      handleEnsureGamesCache(message.payload as { force?: boolean } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'OPEN_DROPS_PAGE_AND_REFRESH':
      openDropsPageAndRefresh()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'ADD_TO_QUEUE':
      handleAddToQueue(message.payload as { game?: TwitchGame })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'REMOVE_FROM_QUEUE':
      handleRemoveFromQueue(message.payload as { game?: TwitchGame; gameId?: string; campaignId?: string })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'CLEAR_QUEUE':
      handleClearQueue()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'START_FARMING':
      handleStartFarming(message.payload as { game?: TwitchGame })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_SELECTED_GAME':
      handleSetSelectedGame(message.payload as { game: TwitchGame })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'PAUSE_FARMING':
      handlePauseFarming()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'RESUME_FARMING':
      handleResumeFarming()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'STOP_FARMING':
      handleStopFarming()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'UPDATE_GAMES':
      appState.availableGames = replaceAvailableGames((message.payload ?? []) as TwitchGame[]);
      appState.availableGames = annotateGameCompletionExt(appState.availableGames, cachedDropsSnapshot);
      if (appState.availableGames.length > 0) {
        appState.lastSuccessfulRefreshAt = Date.now();
      }
      normalizeGameSelectionExt(state, appState.availableGames, true);
      normalizeQueueSelectionExt(state, appState.availableGames, true);
      saveStateExt(state)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      saveTimingStateExt(state).catch(() => undefined);
      return true;

    case 'SYNC_TWITCH_SESSION': {
      const incoming = sanitizeTwitchSession(
        (message.payload as { session?: unknown } | undefined)?.session ?? message.payload,
      );
      if (!incoming) {
        sendResponse({ success: false, error: 'Invalid session payload' });
        return true;
      }
      twitchSessionCache = incoming;
      twitchSessionLastAttemptAt = 0;
      persistTwitchSessionExt(incoming)
        .then(async () => {
          logDebug('Twitch session synced from content script', sessionDebugSummaryExt(incoming));
          if (sender.tab?.id && shouldRefreshCampaignsAfterSessionSync()) {
            await refreshGamesCacheFromHiddenFetch();
            await saveStateExt(state);
            broadcastStateUpdateExt(appState);
          }
        })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    case 'SYNC_TWITCH_INTEGRITY': {
      const payload = message.payload as
        | { token?: string; expiration?: number; request_id?: string }
        | undefined;
      const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
      if (!token) {
        sendResponse({ success: false, error: 'Empty integrity token' });
        return true;
      }
      const expiration = typeof payload?.expiration === 'number' ? payload.expiration : 0;
      logDebug('Integrity token synced from content script', {
        tokenLength: token.length,
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
      // Also store the full integrity object separately for expiration tracking
      chrome.storage.local
        .set({ twitchIntegrity: { token, expiration, request_id: payload?.request_id || '' } })
        .catch(() => undefined);
      sendResponse({ success: true });
      return true;
    }

    case 'REFRESH_DROPS':
      handleRefreshDrops()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_MONITOR_AUTO_OPEN':
      handleSetMonitorAutoOpen(message.payload as { enabled?: boolean } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_MUTE_FARMING_TAB':
      handleSetMuteFarmingTab(message.payload as { enabled?: boolean } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS':
      handleSetAutoClaimChannelPointsBonus(message.payload as { enabled?: boolean } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'CHANNEL_POINTS_BONUS_CLAIMED':
      logDebug('Channel points bonus claimed by content script', { tabId: sender.tab?.id });
      recordChannelPointsBonusClaimed()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_AUTO_CLAIM_DROPS':
      handleSetAutoClaimDrops(message.payload as { enabled?: boolean } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_STREAMER_SELECTION_MODE':
      handleSetStreamerSelectionMode(
        message.payload as { mode?: 'low-view' | 'random' | 'top-viewers' } | undefined,
      )
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_PREFERRED_STREAMER_LANGUAGE':
      handleSetPreferredStreamerLanguage(message.payload as { language?: string | null } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'OPEN_MONITOR_DASHBOARD':
      openMonitorDashboardWindow((message.payload ?? {}) as { toggle?: boolean } | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      return true;
  }
});

chrome.tabs.onRemoved.addListener((removedTabId) => {
  if (appState.tabId === removedTabId) {
    clearManagedTabOwnershipExt(state);
    saveStateExt(state).catch(() => undefined);
  }
});

// Detect when the managed farming tab navigates away from Twitch
chrome.tabs.onUpdated.addListener((updatedTabId, changeInfo) => {
  if (updatedTabId !== appState.tabId || !changeInfo.url) {
    return;
  }
  const isStillOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(changeInfo.url);
  if (!isStillOnTwitch) {
    logInfo('Managed tab navigated away from Twitch (onUpdated)', { url: changeInfo.url });
    // Release the tab so next rotation creates a NEW tab instead of hijacking this one
    clearManagedTabOwnershipExt(state);
    invalidStreamChecks = INVALID_STREAM_THRESHOLD;
    saveStateExt(state).catch(() => undefined);
  }
});

chrome.windows.onRemoved.addListener((removedWindowId) => {
  if (appState.monitorWindowId === removedWindowId) {
    appState.monitorWindowId = null;
    saveStateExt(state).catch(() => undefined);
  }
});

logDebug('DropHunter service worker loaded');
