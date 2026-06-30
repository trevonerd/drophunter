import { browser } from '../shared/browser-api.ts';
import { isDropCompleted } from '../shared/drops';
import { replaceAvailableGames } from '../shared/game-selection';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../shared/runtime-status';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { createInitialState, toSlug } from '../shared/utils';
import { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { applyAutoClaimDropsSetting } from './auto-claim.ts';
import {
  applyAutoClaimChannelPointsBonusSetting,
  ChannelPointsBonusClaimResponse,
  shouldAttemptAutoClaimChannelPointsBonus,
} from './channel-points';
import { clearClaimLog, loadClaimLog } from './claim-log.ts';
import { logDebug, logInfo, logWarn } from './logging';
import { registerRuntimeMessageRouter } from './message-router.ts';
import { openMonitorDashboardWindow as openMonitorDashboardWindowController } from './monitor-dashboard.ts';
import { createNotificationController } from './notifications.ts';
import { needsPlaybackAttention } from './playback.ts';
import { createPlaybackOrchestrator } from './playback-orchestrator.ts';
import { applyStartupResumePolicy, clearRotationMetadata, createServiceWorkerState } from './runtime-state';

export type { RefreshDropsOptions, StreamContext } from './farming-session.ts';
export type { ServiceWorkerState } from './runtime-state';

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
import {
  fetchDirectoryStreamersFromApiWrapper,
  fetchDropsSnapshotFromApiWrapper,
  fetchInventorySnapshotFromApiWrapper,
} from './api-operations.ts';
import {
  CRASH_DETECTION_THRESHOLD_MS,
  PROGRESS_POLL_MS,
  RESUME_RECOVERY_GRACE_MS,
  STREAM_VALIDATION_GRACE_MS,
} from './constants.ts';
import { createDropsPageRefresher } from './drops-page-refresh.ts';
import {
  annotateGameCompletion as annotateGameCompletionExt,
  dropMatchesSelectedGame as dropMatchesSelectedGameExt,
  normalizeGameSelection as normalizeGameSelectionExt,
  splitDropsForSelectedGame as splitDropsForSelectedGameExt,
} from './drops-projection.ts';
import { registerExtensionLifecycleListeners } from './extension-lifecycle.ts';
import { createFarmingSession, type StreamContext } from './farming-session.ts';
import {
  normalizeQueueSelection as normalizeQueueSelectionExt,
  resetStreamTrackingState as resetStreamTrackingStateExt,
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
} from './streamer-selection';
import { TwitchApiClient } from './twitch-api/client';
import { isLikelyAuthError, sanitizeTwitchSession, TwitchSession } from './twitch-api/types';

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

function sameCampaignId(left?: string | null, right?: string | null): boolean {
  return Boolean(left && right && left === right);
}

let initPromise: Promise<void> | null = null;
const state = createServiceWorkerState();

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
const farmingSession = createFarmingSession(state, {
  getInitPromise: () => initPromise,
  trackActivity,
  ensureTwitchSession,
  fetchDropsSnapshotFromApi,
  fetchInventorySnapshotFromApi,
  fetchDirectoryStreamersFromApi,
  fetchStreamContext,
  resolveCategorySlug,
  openForegroundChannel,
  enforcePlaybackPolicyOnStreamTab,
  attemptPlaybackSelfHeal,
  attemptAutoClaimChannelPointsBonus,
  closeManagedTabIfSafe: closeManagedTabIfSafeExt,
  clearManagedTabOwnership: () => clearManagedTabOwnershipExt(state),
  openMonitorDashboardWindow,
  sendAlert,
  notify,
  saveState: saveStateExt,
  saveTimingState: saveTimingStateExt,
  broadcastStateUpdate: broadcastStateUpdateExt,
  monitorAutoOpenDelayMs: MONITOR_AUTO_OPEN_DELAY_MS,
});

const GAMES_STALE_THRESHOLD_MS = 60 * 60_000;

async function resetStateForInactivity(trigger: string, idleForMs: number) {
  logInfo('Resetting state after inactivity', {
    trigger,
    idleForMs,
    wasRunning: state.appState.isRunning,
    wasPaused: state.appState.isPaused,
  });
  await resetStateForInactivityExt(
    state,
    trigger,
    idleForMs,
    {
      onStopMonitoring: farmingSession.stopMonitoring,
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
  const reference = Math.max(state.lastActivityAt, state.appState.lastSuccessfulRefreshAt ?? 0);
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
  // Preserve lifetime stats, user settings, and active farming intent.
  // Wipe volatile timing state and cached tokens (may have schema changes after update).
  const preserved = {
    totalDropsClaimed: state.appState.totalDropsClaimed,
    totalChannelPointsClaimed: state.appState.totalChannelPointsClaimed,
    monitorAutoOpen: state.appState.monitorAutoOpen,
    autoResumeOnStartup: state.appState.autoResumeOnStartup,
    muteFarmingTab: state.appState.muteFarmingTab,
    notificationsEnabled: state.appState.notificationsEnabled,
    autoClaimChannelPointsBonus: state.appState.autoClaimChannelPointsBonus,
    autoClaimDrops: state.appState.autoClaimDrops,
    streamerSelectionMode: state.appState.streamerSelectionMode,
    preferredStreamerLanguage: state.appState.preferredStreamerLanguage,
    queue: state.appState.queue,
    selectedGame: state.appState.selectedGame,
    isRunning: state.appState.isRunning,
  };
  state.appState = clearRotationMetadata({
    ...createInitialState(),
    ...preserved,
  });
  state.cachedDropsSnapshot = [];
  await browser.storage.local.remove([DROPS_SNAPSHOT_CACHE_KEY, TIMING_STATE_KEY, 'twitchIntegrity']);
  await browser.storage.session.remove([TIMING_STATE_KEY]).catch(() => undefined);
  await browser.storage.local.set({ appState: state.appState, [DROPS_SNAPSHOT_CACHE_KEY]: [] });
  broadcastStateUpdateExt(state.appState);
}

async function notify(title: string, message: string, priority = 2) {
  await notificationController.notify(title, message, priority);
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
    farmingSession.startMonitoring();
  }
}

async function canResumeWithExistingManagedTab(): Promise<boolean> {
  if (!state.appState.tabId) {
    return false;
  }
  const tab = await browser.tabs.get(state.appState.tabId).catch(() => null);
  return Boolean(tab?.id && getFarmableTwitchChannelNameFromUrl(tab.url));
}

async function handleStartupResumePolicy() {
  const now = Date.now();
  const startupResumePolicy = applyStartupResumePolicy(
    state,
    now,
    CRASH_DETECTION_THRESHOLD_MS,
    RESUME_RECOVERY_GRACE_MS,
  );

  if (startupResumePolicy === 'resume-recovery') {
    logInfo('SW recycled during active no-tab recovery; resuming monitoring without reset', {
      recoveryReason: state.appState.recoveryReason,
      recoveryAttempts: state.appState.recoveryAttempts,
      secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
    });
    farmingSession.startMonitoring();
    return true;
  }

  if (startupResumePolicy === 'paused-on-startup') {
    logInfo('Long browser restart detected; leaving farming paused', {
      secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
    });
    farmingSession.stopMonitoring();
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
      await farmingSession.acquireStreamerForSelectedGame();
    }
    farmingSession.startMonitoring();
    return true;
  }

  return false;
}

export const GAMES_CACHE_TTL_MS = 5 * 60_000;

async function ensureStateHydratedForCache() {
  const hasRuntimeState =
    state.appState.availableGames.length > 0 ||
    state.appState.queue.length > 0 ||
    Boolean(state.appState.selectedGame) ||
    state.appState.isRunning;
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

function clearSelectedCompletedIdleCampaign() {
  if (state.appState.isRunning || !state.appState.selectedGame || state.appState.queue.length > 0) {
    return;
  }

  const selected = state.appState.selectedGame;
  const selectedDrops = state.cachedDropsSnapshot.filter((drop) =>
    dropMatchesSelectedGameExt(drop, selected),
  );
  const hasKnownDrops = selectedDrops.length > 0;
  const hasFarmablePending = selectedDrops.some(
    (drop) => !isDropCompleted(drop) && drop.dropType !== 'event-based',
  );

  if (!hasKnownDrops || hasFarmablePending) {
    return;
  }

  state.appState.selectedGame = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.appState.completionNotified = false;
  state.previousAllDropsCount = 0;
  resetStreamTrackingStateExt(state);
}

async function applyAuthoritativeEmptyCampaignRefresh(): Promise<void> {
  if (state.appState.isRunning) {
    await farmingSession.stop({
      stopReason: 'no-active-campaigns',
      stopMessage: 'No active Twitch Drops campaigns found.',
    });
  } else {
    state.appState = clearTerminalStopStatus(clearRecoveryStatus(state.appState));
  }

  state.appState.availableGames = [];
  state.appState.queue = [];
  state.appState.selectedGame = null;
  state.appState.currentDrop = null;
  state.appState.allDrops = [];
  state.appState.pendingDrops = [];
  state.appState.completedDrops = [];
  state.appState.completionNotified = false;
  state.appState.lastSuccessfulRefreshAt = Date.now();
  state.cachedDropsSnapshot = [];
  state.cachedCampaignChannelsMap = {};
  state.previousAllDropsCount = 0;
  resetStreamTrackingStateExt(state);
  state.lastGamesCacheRefreshAt = Date.now();
  await saveStateExt(state);
}

async function fetchDropsSnapshotFromApi(forceSessionRefresh = false): Promise<DropsSnapshot | null> {
  return fetchDropsSnapshotFromApiWrapper(
    state,
    forceSessionRefresh,
    {
      onEnsureTwitchSession: ensureTwitchSession,
      onEnsureSessionIntegrity: ensureSessionIntegrityExt,
      onPersistTwitchSession: persistTwitchSessionExt,
      onStopFarmingSession: farmingSession.stop,
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

async function fetchInventorySnapshotFromApi(
  baseDrops: TwitchDrop[],
  forceSessionRefresh = false,
): Promise<DropsSnapshot | null> {
  return fetchInventorySnapshotFromApiWrapper(
    state,
    baseDrops,
    forceSessionRefresh,
    {
      onEnsureTwitchSession: ensureTwitchSession,
      onIsLikelyAuthError: isLikelyAuthError,
      onClearTwitchSessionCache: clearTwitchSessionCacheExt,
      onStopFarmingSession: farmingSession.stop,
    },
    { logWarn },
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
  const send = async () => browser.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' });
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
  options: {
    forceSessionRefresh?: boolean;
    acceptAuthoritativeEmpty?: boolean;
    requireFreshSnapshot?: boolean;
  } = {},
): Promise<TwitchGame[]> {
  if (state.gamesCacheRefreshInFlight) {
    return state.gamesCacheRefreshInFlight;
  }

  state.gamesCacheRefreshInFlight = (async () => {
    let fetchedGames: TwitchGame[] = [];
    const apiSnapshot = await fetchDropsSnapshotFromApi(Boolean(options.forceSessionRefresh));
    if (!apiSnapshot && options.requireFreshSnapshot) {
      return [];
    }
    if (apiSnapshot) {
      if (apiSnapshot.games.length === 0 && apiSnapshot.drops.length === 0) {
        if (options.acceptAuthoritativeEmpty !== false) {
          await applyAuthoritativeEmptyCampaignRefresh();
        }
        return [];
      }
      if (apiSnapshot.games.length > 0) {
        fetchedGames = apiSnapshot.games;
      }
      state.appState.lastSuccessfulRefreshAt = Date.now();
      if (apiSnapshot.drops.length > 0) {
        state.cachedDropsSnapshot = apiSnapshot.drops;
      } else {
        state.cachedDropsSnapshot = [];
      }
      if (apiSnapshot.campaignChannelsMap) {
        state.cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
    }

    const mergedGames =
      fetchedGames.length > 0 ? replaceAvailableGames(fetchedGames) : state.appState.availableGames;
    const annotatedGames = annotateGameCompletionExt(mergedGames, state.cachedDropsSnapshot);
    state.appState.availableGames = annotatedGames;
    normalizeGameSelectionExt(state, annotatedGames);
    normalizeQueueSelectionExt(state, annotatedGames, Boolean(apiSnapshot));
    // If a campaign refresh succeeded, the selected campaign split should reflect it,
    // including the valid "no rewards left" case.
    if (state.appState.selectedGame && apiSnapshot) {
      splitDropsForSelectedGameExt(state, state.cachedDropsSnapshot);
    }
    clearSelectedCompletedIdleCampaign();
    state.lastGamesCacheRefreshAt = Date.now();
    await saveStateExt(state);
    return mergedGames;
  })().finally(() => {
    state.gamesCacheRefreshInFlight = null;
  });

  return state.gamesCacheRefreshInFlight;
}

async function openDropsPageAndRefresh(message?: {
  payload?: { waitForRefresh?: boolean; active?: boolean };
}) {
  if (initPromise) {
    await initPromise;
  }
  return dropsPageRefresher.openDropsPageAndRefresh({
    waitForRefresh: message?.payload?.waitForRefresh,
    active: message?.payload?.active,
  });
}

async function resolveCategorySlug(game: TwitchGame): Promise<string> {
  // Prefer availableGames — may have the correct slug from content script
  const updated = state.appState.availableGames.find(
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

  const tabs = await browser.tabs.query({ url: ['https://www.twitch.tv/*', 'https://twitch.tv/*'] });
  await Promise.all(
    tabs
      .filter((tab) => Boolean(tab.id))
      .map((tab) =>
        browser.tabs
          .sendMessage(tab.id as number, {
            type: 'PLAY_ALERT',
            payload: { kind, message },
          })
          .catch(() => undefined),
      ),
  );
}

async function handleEnsureGamesCache(payload?: { force?: boolean }) {
  if (initPromise) {
    await initPromise;
  }
  await trackActivity('ensure-games-cache');
  await ensureStateHydratedForCache();
  const force = Boolean(payload?.force);
  const shouldRefresh = shouldRefreshGamesCacheExt(state, force);
  if (shouldRefresh) {
    await refreshGamesCacheFromHiddenFetch();
  } else if (state.cachedDropsSnapshot.length > 0) {
    // Cache is fresh — no API call needed. But the games persisted in storage may
    // pre-date the annotation logic (e.g. after an extension update or SW restart).
    // Re-annotate in-memory and persist so the popup reads correct allDropsCompleted flags.
    state.appState.availableGames = annotateGameCompletionExt(
      state.appState.availableGames,
      state.cachedDropsSnapshot,
    );
    await saveStateExt(state);
  }
  return {
    success: true,
    refreshed: shouldRefresh,
    gamesCount: state.appState.availableGames.length,
    games: state.appState.availableGames,
  };
}

async function handleMarkDropsRefreshNoticeSeen(payload?: { seenAt?: number }) {
  if (initPromise) {
    await initPromise;
  }
  const completedAt =
    typeof state.appState.lastDropsPageRefreshCompletedAt === 'number'
      ? state.appState.lastDropsPageRefreshCompletedAt
      : 0;
  const requestedSeenAt =
    typeof payload?.seenAt === 'number' && Number.isFinite(payload.seenAt) ? payload.seenAt : completedAt;
  const seenAt = Math.max(state.appState.lastDropsPageRefreshNoticeSeenAt ?? 0, requestedSeenAt, completedAt);
  state.appState.lastDropsPageRefreshNoticeSeenAt = seenAt || Date.now();
  await saveStateExt(state);
  return { success: true, seenAt: state.appState.lastDropsPageRefreshNoticeSeenAt };
}

async function handleSetMonitorAutoOpen(payload?: { enabled?: boolean }) {
  await trackActivity('set-monitor-auto-open');
  state.appState.monitorAutoOpen = payload?.enabled !== false;
  await saveStateExt(state);
  return { success: true, monitorAutoOpen: state.appState.monitorAutoOpen };
}

async function handleSetAutoResumeOnStartup(payload?: { enabled?: boolean }) {
  if (initPromise) {
    await initPromise;
  }
  await trackActivity('set-auto-resume-on-startup');
  state.appState.autoResumeOnStartup = payload?.enabled === true;
  await saveStateExt(state);
  return { success: true, autoResumeOnStartup: state.appState.autoResumeOnStartup };
}

async function handleSetMuteFarmingTab(payload?: { enabled?: boolean }) {
  await trackActivity('set-mute-farming-tab');
  state.appState.muteFarmingTab = payload?.enabled !== false;
  await Promise.all([saveStateExt(state), syncManagedTabMuteStateExt(state)]);
  return { success: true, muteFarmingTab: state.appState.muteFarmingTab };
}

async function handleSetNotificationsEnabled(payload?: { enabled?: boolean }) {
  await trackActivity('set-notifications-enabled');
  const enabled = payload?.enabled !== false;
  if (!enabled) {
    state.appState.notificationsEnabled = false;
    await saveStateExt(state);
    return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
  }

  if (!(await notificationController.hasNotificationPermission())) {
    state.appState.notificationsEnabled = false;
    await saveStateExt(state);
    return {
      success: false,
      notificationsEnabled: state.appState.notificationsEnabled,
      error: 'Notification permission was not granted',
    };
  }

  state.appState.notificationsEnabled = true;
  await saveStateExt(state);
  return { success: true, notificationsEnabled: state.appState.notificationsEnabled };
}

async function handleSetAutoClaimChannelPointsBonus(payload?: { enabled?: boolean }) {
  await trackActivity('set-auto-claim-channel-points-bonus');
  state.appState = applyAutoClaimChannelPointsBonusSetting(state.appState, payload?.enabled);
  await saveStateExt(state);
  return {
    success: true,
    autoClaimChannelPointsBonus: state.appState.autoClaimChannelPointsBonus,
  };
}

async function handleSetAutoClaimDrops(payload?: { enabled?: boolean }) {
  await trackActivity('set-auto-claim-drops');
  state.appState = applyAutoClaimDropsSetting(state.appState, payload?.enabled);
  await saveStateExt(state);
  return {
    success: true,
    autoClaimDrops: state.appState.autoClaimDrops,
  };
}

async function handleGetClaimLog() {
  try {
    return { success: true, entries: await loadClaimLog() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function handleClearClaimLog() {
  try {
    await clearClaimLog();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function handleSetStreamerSelectionMode(payload?: { mode?: 'low-view' | 'random' | 'top-viewers' }) {
  await trackActivity('set-streamer-selection-mode');
  state.appState = applyStreamerSelectionModeSetting(state.appState, payload?.mode);
  await saveStateExt(state);
  return {
    success: true,
    streamerSelectionMode: state.appState.streamerSelectionMode,
  };
}

async function handleSetPreferredStreamerLanguage(payload?: { language?: string | null }) {
  await trackActivity('set-preferred-streamer-language');
  state.appState = applyPreferredStreamerLanguageSetting(state.appState, payload?.language);
  await saveStateExt(state);
  return {
    success: true,
    preferredStreamerLanguage: state.appState.preferredStreamerLanguage,
  };
}

async function attemptAutoClaimChannelPointsBonus() {
  if (!shouldAttemptAutoClaimChannelPointsBonus(state.appState)) {
    return false;
  }

  const tabId = state.appState.tabId;
  if (tabId == null) {
    return false;
  }

  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.id) {
    return false;
  }

  await ensureContentScriptOnTab(tab.id);
  const result = (await browser.tabs
    .sendMessage(tab.id, {
      type: 'CLAIM_CHANNEL_POINTS_BONUS',
    })
    .catch(() => null)) as ChannelPointsBonusClaimResponse | null;

  if (result?.success && result.claimed) {
    const channelName = getChannelNameFromTab(tab.url) ?? state.appState.activeStreamer?.displayName ?? null;
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

function isTrustedTwitchSender(sender: chrome.runtime.MessageSender): boolean {
  const url = sender.tab?.url ?? sender.url ?? '';
  if (getFarmableTwitchChannelNameFromUrl(url) !== null) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return /(^|\.)twitch\.tv$/i.test(parsed.hostname) && /^\/drops\/campaigns(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function recordChannelPointsBonusClaimed(channelName?: string | null) {
  await ensureInitializedForStatsUpdate();
  state.appState.totalChannelPointsClaimed = state.appState.totalChannelPointsClaimed + 1;
  await saveStateExt(state);
  const fromChannel = channelName ? ` from ${channelName}` : '';
  await notify('Channel points claimed', `Claimed${fromChannel}.`, 0);
}

async function handleUpdateGames(payload?: TwitchGame[]) {
  state.appState.availableGames = replaceAvailableGames(payload ?? []);
  state.appState.availableGames = annotateGameCompletionExt(
    state.appState.availableGames,
    state.cachedDropsSnapshot,
  );
  if (state.appState.availableGames.length > 0) {
    state.appState.lastSuccessfulRefreshAt = Date.now();
  }
  normalizeGameSelectionExt(state, state.appState.availableGames, true);
  normalizeQueueSelectionExt(state, state.appState.availableGames, true);
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
  if (!isTrustedTwitchSender(sender)) {
    return { success: false, error: 'Untrusted message sender' };
  }
  if (initPromise) {
    await initPromise;
  }
  const incoming = sanitizeTwitchSession(sessionPayloadCandidate(payload));
  if (!incoming) {
    return { success: false, error: 'Invalid session payload' };
  }
  state.twitchSessionCache = incoming;
  state.twitchSessionLastAttemptAt = 0;
  await persistTwitchSessionExt(incoming);
  logDebug('Twitch session synced from content script', sessionDebugSummaryExt(incoming));
  if (sender.tab?.id && shouldRefreshCampaignsAfterSessionSync()) {
    await refreshGamesCacheFromHiddenFetch();
    await saveStateExt(state);
    broadcastStateUpdateExt(state.appState);
  }
  return { success: true };
}

async function handleSyncTwitchIntegrity(
  payload?: {
    token?: string;
    expiration?: number;
    request_id?: string;
  },
  sender?: chrome.runtime.MessageSender,
) {
  if (!sender || !isTrustedTwitchSender(sender)) {
    return { success: false, error: 'Untrusted message sender' };
  }
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
  if (!token) {
    return { success: false, error: 'Empty integrity token' };
  }
  const expiration = typeof payload?.expiration === 'number' ? payload.expiration : 0;
  logDebug('Integrity token synced from content script', {
    hasToken: true,
    expiration,
    hasSession: Boolean(state.twitchSessionCache),
  });
  // A fresh page-intercepted token means integrity is working — reset the fallback flag
  // so the next request re-attempts with integrity instead of staying in no-integrity mode.
  state.integrityFallbackActive = false;
  state.integrityFallbackActiveUntil = 0;
  if (state.twitchSessionCache) {
    state.twitchSessionCache = { ...state.twitchSessionCache, clientIntegrity: token };
    persistTwitchSessionExt(state.twitchSessionCache).catch(() => undefined);
  }
  // Also store the full integrity object separately for expiration tracking.
  browser.storage.local
    .set({ twitchIntegrity: { token, expiration, request_id: payload?.request_id || '' } })
    .catch(() => undefined);
  return { success: true };
}

async function handleChannelPointsBonusClaimed(
  payload: { channelName?: string | null } | undefined,
  sender: chrome.runtime.MessageSender,
) {
  if (!isTrustedTwitchSender(sender)) {
    return { success: false, error: 'Untrusted message sender' };
  }
  logDebug('Channel points bonus claimed by content script', { tabId: sender.tab?.id });
  await recordChannelPointsBonusClaimed(payload?.channelName ?? getChannelNameFromTab(sender.tab?.url));
  return { success: true };
}

let serviceWorkerStarted = false;

export function startServiceWorker(): void {
  if (serviceWorkerStarted) {
    return;
  }
  serviceWorkerStarted = true;

  // Initialize state as soon as the SW starts. This handles the common case where
  // a browser alarm wakes the SW from dormancy without onStartup/onInstalled.
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
    onAlarm: () => farmingSession.checkDropProgress(),
    onManagedTabRemoved: (removedTabId) => handleManagedTabRemoved(removedTabId),
    onManagedTabNavigatedAway: (updatedTabId, url) => handleManagedTabNavigatedAway(updatedTabId, url),
    onMonitorWindowRemoved: (removedWindowId) => handleMonitorWindowRemoved(removedWindowId),
    logWarn,
  });

  registerRuntimeMessageRouter({
    ensureGamesCache: (message) => handleEnsureGamesCache(message.payload),
    openDropsPageAndRefresh: (message) => openDropsPageAndRefresh(message),
    markDropsRefreshNoticeSeen: (message) => handleMarkDropsRefreshNoticeSeen(message.payload),
    addToQueue: (message) => farmingSession.handleAddToQueue(message.payload),
    removeFromQueue: (message) => farmingSession.handleRemoveFromQueue(message.payload),
    reorderQueue: (message) => farmingSession.handleReorderQueue(message.payload),
    clearQueue: () => farmingSession.handleClearQueue(),
    startFarming: (message) => farmingSession.handleStartFarming(message.payload),
    setSelectedGame: (message) => farmingSession.handleSetSelectedGame(message.payload),
    pauseFarming: () => farmingSession.handlePauseFarming(),
    setAutoResumeOnStartup: (message) => handleSetAutoResumeOnStartup(message.payload),
    resumeFarming: () => farmingSession.handleResumeFarming(),
    stopFarming: () => farmingSession.handleStopFarming(),
    updateGames: (message) => handleUpdateGames(message.payload),
    syncTwitchSession: (message, sender) => handleSyncTwitchSession(message.payload, sender),
    syncTwitchIntegrity: (message, sender) => handleSyncTwitchIntegrity(message.payload, sender),
    refreshDrops: () => farmingSession.handleRefreshDrops(),
    setMonitorAutoOpen: (message) => handleSetMonitorAutoOpen(message.payload),
    setMuteFarmingTab: (message) => handleSetMuteFarmingTab(message.payload),
    setNotificationsEnabled: (message) => handleSetNotificationsEnabled(message.payload),
    setAutoClaimChannelPointsBonus: (message) => handleSetAutoClaimChannelPointsBonus(message.payload),
    channelPointsBonusClaimed: (message, sender) => handleChannelPointsBonusClaimed(message.payload, sender),
    setAutoClaimDrops: (message) => handleSetAutoClaimDrops(message.payload),
    setStreamerSelectionMode: (message) => handleSetStreamerSelectionMode(message.payload),
    setPreferredStreamerLanguage: (message) => handleSetPreferredStreamerLanguage(message.payload),
    openMonitorDashboard: (message) => openMonitorDashboardWindow(message.payload ?? {}),
    getClaimLog: () => handleGetClaimLog(),
    clearClaimLog: () => handleClearClaimLog(),
  });

  logDebug('DropHunter service worker loaded');
}

async function handleManagedTabRemoved(removedTabId: number) {
  if (state.appState.tabId === removedTabId) {
    clearManagedTabOwnershipExt(state);
    await saveStateExt(state);
  }
}

// Detect when the managed farming tab navigates away from Twitch
async function handleManagedTabNavigatedAway(updatedTabId: number, url: string) {
  if (updatedTabId !== state.appState.tabId) {
    return;
  }
  logInfo('Managed tab navigated away from Twitch (onUpdated)', { url });
  // Release the tab so next rotation creates a new tab instead of hijacking this one.
  clearManagedTabOwnershipExt(state);
  state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
  await saveStateExt(state);
}

async function handleMonitorWindowRemoved(removedWindowId: number) {
  if (state.appState.monitorWindowId === removedWindowId) {
    state.appState.monitorWindowId = null;
    await saveStateExt(state);
  }
}
