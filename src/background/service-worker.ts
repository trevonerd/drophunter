import { browser } from '../shared/browser-api.ts';
import {
  dropMatchesGame,
  gameKey,
  isFavoriteGame,
  replaceAvailableGames,
  resolveCategorySlug as resolveCategorySlugExt,
} from '../shared/game-selection';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../shared/runtime-status';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { createInitialState, isExpiredGame } from '../shared/utils';
import { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer, WatchTransportMode } from '../types';
import { applyAutoClaimDropsSetting } from './auto-claim.ts';
import { type AutoStartCandidate, createAutoStartCoordinator } from './auto-start-coordinator.ts';
import { clearAutoStartSnooze, isAutoStartSnoozed, setAutoStartSnoozed } from './auto-start-session.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import { automationNotificationPersistence } from './automation-notification-persistence.ts';
import { orderCampaignCandidates } from './campaign-priority.ts';
import {
  applyAutoClaimChannelPointsBonusSetting,
  attemptAutoClaimChannelPointsBonusExt,
  recordChannelPointsBonusClaimedExt,
} from './channel-points';
import { clearClaimLog, loadClaimLog, setClaimRecordedHandler } from './claim-log.ts';
import { logDebug, logInfo, logWarn } from './logging';
import { registerRuntimeMessageRouter } from './message-router.ts';
import { openMonitorDashboardWindow as openMonitorDashboardWindowController } from './monitor-dashboard.ts';
import { createNotificationController } from './notifications.ts';
import { needsPlaybackAttention } from './playback.ts';
import { createPlaybackOrchestrator } from './playback-orchestrator.ts';
import {
  applyExtensionUpdateStateTransition,
  applyStartupResumePolicy,
  clearRotationMetadata,
  createServiceWorkerState,
} from './runtime-state';
import {
  createTelegramNotifier,
  getTelegramSettingsSummary,
  loadTelegramCredentials,
  saveTelegramCredentials,
} from './telegram-notifications.ts';

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
  INVALID_STREAM_THRESHOLD,
  PROGRESS_POLL_MS,
  RESUME_RECOVERY_GRACE_MS,
  STREAM_VALIDATION_GRACE_MS,
} from './constants.ts';
import { createDropsPageRefresher } from './drops-page-refresh.ts';
import {
  annotateGameCompletion as annotateGameCompletionExt,
  clearSelectedCompletedIdleCampaignExt,
  normalizeGameSelection as normalizeGameSelectionExt,
  recordEmptyCampaignObservation,
  resetStateForAuthoritativeEmptyCampaignExt,
  splitDropsForSelectedGame as splitDropsForSelectedGameExt,
} from './drops-projection.ts';
import { registerExtensionLifecycleListeners } from './extension-lifecycle.ts';
import { createFarmingSession, type StreamContext } from './farming-session.ts';
import { discoverFavoriteCampaigns, setGameFavorite } from './favorite-games.ts';
import {
  type EnsureGamesCacheDeps,
  type GamesCacheRefreshDeps,
  handleEnsureGamesCache,
  refreshGamesCacheFromHiddenFetch,
} from './games-cache-orchestration.ts';
import { detectManualViewing } from './manual-watch-detector.ts';
import { normalizeQueueSelection as normalizeQueueSelectionExt } from './queue-operations.ts';
import { resetStreamTrackingState as resetStreamTrackingStateExt } from './session-lifecycle.ts';
import {
  clearTwitchSessionCache as clearTwitchSessionCacheExt,
  ensureSessionIntegrity as ensureSessionIntegrityExt,
  ensureTwitchSession as ensureTwitchSessionExt,
  persistTwitchSession as persistTwitchSessionExt,
  readTwitchSessionViaExecuteScript as readTwitchSessionViaExecuteScriptExt,
  syncTwitchIntegrityFromContentScriptExt,
  syncTwitchSessionFromContentScriptExt,
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
import { initializeAfterStorageMigration } from './storage-migrations.ts';
import {
  applyPreferredStreamerLanguageSetting,
  applyStreamerSelectionModeSetting,
} from './streamer-selection';
import { TwitchApiClient } from './twitch-api/client';
import { createTwitchSpadeHeartbeat } from './twitch-api/spade-heartbeat.ts';
import {
  DEFAULT_TWITCH_CLIENT_ID,
  isLikelyAuthError,
  sanitizeTwitchSession,
  TwitchSession,
} from './twitch-api/types';
import { dropsForFarmingTarget } from './watch-target.ts';
import type { FarmingTarget } from './watch-transport.ts';
import { createWatchTransportCoordinator } from './watch-transport-coordinator.ts';

export const MONITOR_AUTO_OPEN_DELAY_MS = 450;
export const TWITCH_SESSION_STORAGE_KEY = 'twitchSession';
export const DROPS_SNAPSHOT_CACHE_KEY = 'dropsSnapshotCache';
export const TIMING_STATE_KEY = 'timingState';
export const LAST_ACTIVITY_AT_KEY = 'lastActivityAt';
export const ALARM_NAME = 'dropCheck';
export const INACTIVITY_RESET_MS = 3 * 24 * 60 * 60_000; // 3 days
export const STREAM_CONTEXT_TIMEOUT_MS = 12_000;
export const AUTO_START_ALARM_NAME = 'favoriteCampaignCheck';
export const LINK_RECHECK_ALARM_PREFIX = 'campaignLinkRecheck:';
export const AUTO_START_CHECK_INTERVAL_MS = 2 * 60_000;
const CAMPAIGN_AVAILABILITY_CACHE_MS = 60_000;

let initPromise: Promise<void> | null = null;
let autoStartSnoozedForSession = false;
const state = createServiceWorkerState();

const notificationController = createNotificationController(state, {
  saveState: () => saveStateExt(state),
  automationNotificationPersistence,
  openDropHunter: () => openMonitorDashboardWindow({ toggle: false }),
  pauseFarming: async () => {
    autoStartSnoozedForSession = true;
    await setAutoStartSnoozed();
    await farmingSession.handlePauseFarming();
  },
});
const telegramNotifier = createTelegramNotifier(state, {
  saveState: () => saveStateExt(state),
  loadCredentials: loadTelegramCredentials,
  saveCredentials: saveTelegramCredentials,
});
setClaimRecordedHandler((entries) => telegramNotifier.notifyClaimedDrops(entries));
const sessionOrchestrator = createSessionOrchestrator(state, {
  sanitizeTwitchSession,
  sessionDebugSummary: sessionDebugSummaryExt,
  readTwitchSessionViaExecuteScript: readTwitchSessionViaExecuteScriptExt,
  persistTwitchSession: persistTwitchSessionExt,
  logDebug,
  logWarn,
});
const gamesCacheRefreshDeps: GamesCacheRefreshDeps = {
  fetchDropsSnapshot: (forceSessionRefresh) => fetchDropsSnapshotFromApi(forceSessionRefresh),
  replaceAvailableGames,
  annotateGameCompletion: annotateGameCompletionExt,
  normalizeGameSelection: normalizeGameSelectionExt,
  normalizeQueueSelection: normalizeQueueSelectionExt,
  splitDropsForSelectedGame: splitDropsForSelectedGameExt,
  recordEmptyCampaignObservation,
  resetStateForAuthoritativeEmptyCampaign: resetStateForAuthoritativeEmptyCampaignExt,
  clearSelectedCompletedIdleCampaign: clearSelectedCompletedIdleCampaignExt,
  resetStreamTrackingState: resetStreamTrackingStateExt,
  clearRecoveryStatus,
  clearTerminalStopStatus,
  stopFarmingSession: (args) => farmingSession.stop(args),
  saveState: saveStateExt,
};
const ensureGamesCacheDeps: EnsureGamesCacheDeps = {
  awaitInitPromise: () => initPromise,
  trackActivity,
  ensureStateHydratedForCache,
  shouldRefreshGamesCache: shouldRefreshGamesCacheExt,
  refreshGamesCacheFromHiddenFetch: (options) =>
    refreshGamesCacheFromHiddenFetch(state, options, gamesCacheRefreshDeps),
  saveState: saveStateExt,
};
const dropsPageRefresher = createDropsPageRefresher(state, {
  trackActivity,
  ensureStateHydratedForCache,
  waitForTabComplete: waitForTabCompleteExt,
  persistSessionFromDropsPage,
  refreshGamesCacheFromHiddenFetch: (options) =>
    refreshGamesCacheFromHiddenFetch(state, options, gamesCacheRefreshDeps),
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
const twitchSpadeHeartbeat = createTwitchSpadeHeartbeat({
  clientId: DEFAULT_TWITCH_CLIENT_ID,
});
const watchTransport = createWatchTransportCoordinator({
  state,
  enabled: true,
  heartbeat: async (target) => {
    const session = state.twitchSessionCache ?? (await ensureTwitchSession());
    const userId = session?.userId?.trim();
    if (!userId) {
      return { accepted: false, isLive: true, reason: 'error' };
    }
    const heartbeat = await twitchSpadeHeartbeat.heartbeat(target, userId);
    const progress = await currentInventoryProgress(target);
    return { ...heartbeat, progress };
  },
  managedTab: {
    open: async (target) => {
      const streamer: TwitchStreamer = {
        id: target.channelName,
        name: target.channelName,
        displayName: target.channelName,
        isLive: true,
      };
      const tabId = await openManagedWatchChannel(streamer);
      return tabId === null ? null : { owner: 'drophunter', tabId };
    },
    probe: async (session, target) => {
      const context = await fetchStreamContext(session.tabId);
      const selected = state.appState.selectedGame;
      const sameChannel = context?.channelName.toLowerCase() === target.channelName.toLowerCase();
      const sameGame =
        selected?.id === target.gameId ||
        (Boolean(selected?.categorySlug) && context?.categorySlug === selected?.categorySlug);
      return {
        accepted: Boolean(context) && sameChannel && sameGame && context?.isPlaybackReady === true,
        isLive: context?.isLive,
        sameChannel,
        sameGame,
        hasDropsSignal: context?.hasDropsSignal,
        progress: state.appState.currentDrop?.currentMinutes ?? null,
        reason: !context
          ? 'heartbeat-failed'
          : !sameChannel
            ? 'wrong-channel'
            : !sameGame
              ? 'wrong-game'
              : context.isPlaybackReady !== true
                ? 'playback-inactive'
                : 'heartbeat',
      };
    },
    close: async (session) => {
      await closeManagedTabIfSafeExt(session.tabId);
      if (state.appState.tabId === session.tabId) {
        state.appState.tabId = null;
      }
    },
  },
  persist: () => saveStateExt(state),
  broadcast: () => broadcastStateUpdateExt(state.appState),
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
  watchTransport,
});

const campaignAvailabilityCache = new Map<string, { readonly count: number; readonly cachedAt: number }>();
let manualWatchResumeTimer: ReturnType<typeof setTimeout> | null = null;

function formatRemainingTime(targetAt: string | null | undefined, now = Date.now()): string {
  if (!targetAt) return 'unknown';
  const remainingMs = Date.parse(targetAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'now';
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function activityId(kind: string, game: TwitchGame, at: number): string {
  return `${kind}:${game.campaignId ?? game.id}:${at}`;
}

async function eligibleStreamerCount(game: TwitchGame): Promise<number> {
  const key = game.campaignId ?? game.id;
  const cached = campaignAvailabilityCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CAMPAIGN_AVAILABILITY_CACHE_MS) {
    return cached.count;
  }
  const streamers = await fetchDirectoryStreamersFromApi(
    game,
    false,
    state.appState.preferredStreamerLanguage ?? '',
  );
  const allowed = game.allowedChannels;
  const count =
    allowed === null || allowed === undefined
      ? streamers.length
      : streamers.filter((streamer) =>
          allowed.some((channel) => channel.toLowerCase() === streamer.name.toLowerCase()),
        ).length;
  campaignAvailabilityCache.set(key, { count, cachedAt: Date.now() });
  state.appState.campaignAvailabilityByKey[gameKey(game)] = {
    eligibleStreamerCount: count,
    updatedAt: Date.now(),
  };
  return count;
}

async function discoverAutoStartCandidates(): Promise<readonly AutoStartCandidate[]> {
  const discovery = discoverFavoriteCampaigns(state.appState, Date.now());
  if (discovery.added.length > 0) {
    await notifyFavoriteAdditions(discovery.added);
    await saveStateExt(state);
  }
  const favoriteIds = new Set(state.appState.favoriteGames.map((favorite) => favorite.gameId));
  const favoriteCampaigns = state.appState.availableGames.filter((game) => isFavoriteGame(game, favoriteIds));
  return Promise.all(
    favoriteCampaigns.map(async (game): Promise<AutoStartCandidate> => {
      const campaignDrops =
        state.appState.campaignDropsByKey[gameKey(game)] ??
        state.appState.allDrops.filter((drop) => dropMatchesGame(drop, game));
      return {
        game,
        eligibleStreamerCount: await eligibleStreamerCount(game),
        hasStartedReward: campaignDrops.some((drop) => drop.progress > 0 && !drop.claimed),
        hasFarmableReward: campaignDrops.some((drop) => !drop.claimed && isRewardFarmableNow(drop)),
        isActive:
          !isExpiredGame(game) &&
          (game.rewardSummary?.completion === undefined || game.rewardSummary.completion === 'farmable'),
        isFavorite: true,
      };
    }),
  );
}

async function notifyFavoriteAdditions(
  additions: ReturnType<typeof discoverFavoriteCampaigns>['added'],
): Promise<void> {
  for (const addition of additions) {
    const message = `${addition.game.name} was added because a new favorite campaign is available.`;
    const at = Date.now();
    recordAutomationActivity(state.appState, {
      id: activityId('favorite-added', addition.game, at),
      kind: 'favorite-added',
      at,
      campaignId: addition.game.campaignId,
      message,
    });
    await notificationController.notifyAutomation({
      event: 'favorite-added',
      campaignId: addition.game.campaignId ?? addition.game.id,
      title: 'Favorite campaign added',
      message,
    });
  }
}

const autoStartCoordinator = createAutoStartCoordinator({
  getState: () => ({
    autoStartFavoriteGames: state.appState.autoStartFavoriteGames,
    notificationsEnabled: state.appState.notificationsEnabled,
    isRunning: state.appState.isRunning,
    isPaused: state.appState.isPaused,
    selectedGame: state.appState.selectedGame,
    manualWatchActive: state.appState.manualWatchState !== 'inactive',
    autoStartSnoozed: autoStartSnoozedForSession,
    twitchSessionValid: state.twitchSessionCache !== null,
  }),
  refreshDrops: async () => {
    await farmingSession.handleRefreshDrops();
  },
  discoverCandidates: discoverAutoStartCandidates,
  rankCandidates: (candidates) => {
    const candidateByKey = new Map(
      candidates.map((candidate) => [candidate.game.campaignId ?? candidate.game.id, candidate]),
    );
    return orderCampaignCandidates(candidates, {
      mode: state.appState.campaignPriorityMode,
      scope: state.appState.farmCategoryScope,
      favoriteGameIds: new Set(state.appState.favoriteGames.map((favorite) => favorite.gameId)),
      priorityList: state.appState.queue,
    }).flatMap((ranked) => {
      const candidate = candidateByKey.get(ranked.game.campaignId ?? ranked.game.id);
      return candidate ? [candidate] : [];
    });
  },
  onRankedCampaigns: async (ranked) => {
    const discovery = discoverFavoriteCampaigns(state.appState, Date.now());
    await notifyFavoriteAdditions(discovery.added);
    const target = ranked[0]?.game;
    if (target) {
      const manual = await detectManualViewing({
        target,
        managedTabId: state.appState.tabId,
        automationActive: true,
        now: Date.now(),
        queryTabs: async () =>
          (await browser.tabs.query({ url: ['https://www.twitch.tv/*', 'https://twitch.tv/*'] })).map(
            (tab) => ({ id: tab.id, active: tab.active, url: tab.url }),
          ),
        getStreamContext: fetchStreamContext,
      });
      state.appState.manualWatchState = manual.kind;
      if (manual.kind !== 'inactive' && manualWatchResumeTimer === null) {
        manualWatchResumeTimer = setTimeout(() => {
          manualWatchResumeTimer = null;
          void autoStartCoordinator.evaluate('periodic');
        }, 20_000);
      }
    } else {
      state.appState.manualWatchState = 'inactive';
    }
    state.appState.nextAutomationCheckAt = Date.now() + AUTO_START_CHECK_INTERVAL_MS;
    await saveStateExt(state);
  },
  hasNotificationPermission: notificationController.hasNotificationPermission,
  startFarming: async (campaign, context) => {
    const result = await farmingSession.handleStartFarming({ game: campaign });
    if (!result.success) {
      throw new Error(result.error ?? 'Unable to start farming.');
    }
    const at = Date.now();
    const nextReward = state.appState.pendingDrops.find((drop) => dropMatchesGame(drop, campaign));
    if (context.preempted && context.currentCampaign) {
      const earlierMs = Math.max(
        0,
        Date.parse(context.currentCampaign.endsAt ?? '') - Date.parse(campaign.endsAt ?? ''),
      );
      const earlier = formatRemainingTime(new Date(Date.now() + earlierMs).toISOString());
      const message = `${campaign.name} starts now because its campaign ends ${earlier} earlier.`;
      recordAutomationActivity(state.appState, {
        id: activityId('preempted', campaign, at),
        kind: 'preempted',
        at,
        campaignId: campaign.campaignId,
        message,
      });
      await notificationController.notifyAutomation({
        event: 'preemption',
        campaignId: campaign.campaignId ?? campaign.id,
        title: 'Campaign priority changed',
        message,
      });
    } else {
      const campaignLabel = campaign.campaignName ?? campaign.name;
      const rewardEta = nextReward?.remainingMinutes
        ? `${Math.ceil(nextReward.remainingMinutes)}m`
        : 'calculating';
      const message = `${campaignLabel} · Next reward in ${rewardEta} · Ends in ${formatRemainingTime(campaign.endsAt)}`;
      recordAutomationActivity(state.appState, {
        id: activityId('auto-started', campaign, at),
        kind: 'auto-started',
        at,
        campaignId: campaign.campaignId,
        message: `${campaign.name} started automatically.`,
      });
      await notificationController.notifyAutomation({
        event: 'start',
        campaignId: campaign.campaignId ?? campaign.id,
        title: `DropHunter started ${campaign.name}`,
        message,
      });
    }
    await saveStateExt(state);
  },
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
  applyExtensionUpdateStateTransition(state);
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
  return resolveCategorySlugExt(game, state.appState.availableGames);
}

async function openForegroundChannel(streamer: TwitchStreamer) {
  await playbackOrchestrator.openForegroundChannel(streamer);
}

async function openManagedWatchChannel(streamer: TwitchStreamer): Promise<number | null> {
  return playbackOrchestrator.openForegroundChannel(streamer, { focus: false });
}

async function currentInventoryProgress(target: FarmingTarget): Promise<number | null> {
  const cached = state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops;
  const baseDrops = dropsForFarmingTarget(cached, target);
  if (baseDrops.length === 0) {
    return state.appState.currentDrop?.currentMinutes ?? null;
  }
  const snapshot = await fetchInventorySnapshotFromApi(baseDrops, true);
  const drops = snapshot?.drops ?? baseDrops;
  const progress = dropsForFarmingTarget(drops, target)
    .map((drop) => drop.currentMinutes)
    .filter((minutes) => Number.isFinite(minutes));
  return progress.length > 0 ? Math.max(...progress) : null;
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

async function handleSetGameFavorite(payload: { game: TwitchGame; favorite: boolean }) {
  await trackActivity('set-game-favorite');
  const result = setGameFavorite(state.appState, payload.game, payload.favorite, Date.now());
  let additions: ReturnType<typeof discoverFavoriteCampaigns>['added'] = [];
  if (payload.favorite) {
    additions = discoverFavoriteCampaigns(state.appState, Date.now()).added;
  }
  await notifyFavoriteAdditions(additions);
  await saveStateExt(state);
  if (payload.favorite && state.appState.autoStartFavoriteGames) {
    void autoStartCoordinator.evaluate('campaign-refresh');
  }
  return {
    success: true,
    favorite: isFavoriteGame(
      payload.game,
      new Set(state.appState.favoriteGames.map((favorite) => favorite.gameId)),
    ),
    removedQueueEntries: result.removedQueueEntries,
  };
}

async function handleSetCampaignPriorityMode(payload: {
  mode: 'ending-soonest' | 'lowest-availability' | 'priority-list-only';
}) {
  await trackActivity('set-campaign-priority-mode');
  state.appState.campaignPriorityMode = payload.mode;
  discoverFavoriteCampaigns(state.appState, Date.now());
  await saveStateExt(state);
  if (state.appState.autoStartFavoriteGames) {
    void autoStartCoordinator.evaluate('campaign-refresh');
  }
  return { success: true, campaignPriorityMode: state.appState.campaignPriorityMode };
}

async function handleSetFarmCategoryScope(payload: { scope: 'all' | 'favorites-only' }) {
  await trackActivity('set-farm-category-scope');
  state.appState.farmCategoryScope = payload.scope;
  await saveStateExt(state);
  if (state.appState.autoStartFavoriteGames) {
    void autoStartCoordinator.evaluate('campaign-refresh');
  }
  return { success: true, farmCategoryScope: state.appState.farmCategoryScope };
}

async function handleSetAutoStartFavorites(payload?: { enabled?: boolean }) {
  await trackActivity('set-auto-start-favorites');
  if (payload?.enabled !== true) {
    state.appState.autoStartFavoriteGames = false;
    await saveStateExt(state);
    return { success: true, autoStartFavoriteGames: false };
  }
  const notificationResult = await notificationController.setNotificationsEnabled(true);
  state.appState.autoStartFavoriteGames = notificationResult.success;
  await saveStateExt(state);
  if (notificationResult.success) {
    void autoStartCoordinator.evaluate('campaign-refresh');
  }
  return {
    success: notificationResult.success,
    autoStartFavoriteGames: state.appState.autoStartFavoriteGames,
    error: notificationResult.error,
  };
}

async function handleSetWatchTransportMode(payload: { mode: WatchTransportMode }) {
  await trackActivity('set-watch-transport-mode');
  const currentStreamer = state.appState.activeStreamer;
  if (state.appState.isRunning && !state.appState.isPaused && currentStreamer) {
    await watchTransport.stop();
  }
  await watchTransport.setPreference(payload.mode);
  if (state.appState.isRunning && !state.appState.isPaused && currentStreamer) {
    await watchTransport.start(currentStreamer);
  }
  return {
    success: true,
    watchTransportPreference: state.appState.watchTransportPreference,
  };
}

async function handleEvaluateAutoStart() {
  const result = await autoStartCoordinator.evaluate('campaign-refresh');
  return {
    success: true,
    started: result.started,
    reason: result.started ? 'Campaign started automatically.' : result.skipReason,
  };
}

async function handleSetMuteFarmingTab(payload?: { enabled?: boolean }) {
  await trackActivity('set-mute-farming-tab');
  state.appState.muteFarmingTab = payload?.enabled !== false;
  await Promise.all([saveStateExt(state), syncManagedTabMuteStateExt(state)]);
  return { success: true, muteFarmingTab: state.appState.muteFarmingTab };
}

async function handleSetNotificationsEnabled(payload?: { enabled?: boolean }) {
  await trackActivity('set-notifications-enabled');
  const result = await notificationController.setNotificationsEnabled(payload?.enabled !== false);
  if (!result.notificationsEnabled && state.appState.autoStartFavoriteGames) {
    state.appState.autoStartFavoriteGames = false;
    await saveStateExt(state);
  }
  return result;
}

async function handleSetTelegramAlertsEnabled(payload?: { enabled?: boolean }) {
  await trackActivity('set-telegram-alerts-enabled');
  return telegramNotifier.setTelegramAlertsEnabled(payload?.enabled !== false);
}

async function handleSetTelegramCredentials(payload?: {
  botToken?: string;
  chatId?: string;
  clearToken?: boolean;
}) {
  await trackActivity('set-telegram-credentials');
  return telegramNotifier.setTelegramCredentials(payload ?? {});
}

async function handleTestTelegramAlerts() {
  await trackActivity('test-telegram-alerts');
  return telegramNotifier.sendTestAlert();
}

async function handleGetTelegramSettings() {
  try {
    const summary = await getTelegramSettingsSummary();
    return { success: true, ...summary };
  } catch (error) {
    return { success: false, error: String(error) };
  }
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
  return attemptAutoClaimChannelPointsBonusExt(state.appState, {
    ensureContentScriptOnTab,
    sendMessageToTab: (tabId: number, message: unknown) =>
      browser.tabs.sendMessage(tabId, message).catch(() => null),
    getTab: (tabId: number) => browser.tabs.get(tabId).catch(() => null),
    recordBonusClaimed: recordChannelPointsBonusClaimed,
  });
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
  await recordChannelPointsBonusClaimedExt(
    state.appState,
    {
      saveState: () => saveStateExt(state),
      notify,
      awaitInit: ensureInitializedForStatsUpdate,
    },
    channelName,
  );
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
  return syncTwitchSessionFromContentScriptExt(state, sessionPayloadCandidate(payload), sender.tab?.id, {
    shouldRefreshCampaignsAfterSessionSync,
    onRefreshCampaigns: () =>
      refreshGamesCacheFromHiddenFetch(
        state,
        { requireConsecutiveEmptyConfirmation: true },
        gamesCacheRefreshDeps,
      ),
    onSaveState: () => saveStateExt(state),
    onBroadcastStateUpdate: () => broadcastStateUpdateExt(state.appState),
  });
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
  return syncTwitchIntegrityFromContentScriptExt(state, payload);
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
  initPromise = initializeAfterStorageMigration(loadState).then(async () => {
    await notificationController.syncPermissionState();
    await telegramNotifier.syncPermissionState();
    autoStartSnoozedForSession = await isAutoStartSnoozed();
    browser.alarms.create(AUTO_START_ALARM_NAME, {
      periodInMinutes: AUTO_START_CHECK_INTERVAL_MS / 60_000,
    });
  });
  void initPromise.catch((error) => {
    logWarn('SW initialization failed:', String(error));
  });

  registerExtensionLifecycleListeners({
    alarmName: ALARM_NAME,
    automationAlarmName: AUTO_START_ALARM_NAME,
    linkRecheckAlarmPrefix: LINK_RECHECK_ALARM_PREFIX,
    getInitPromise: () => initPromise,
    onBrowserStartup: async () => {
      await clearAutoStartSnooze();
      autoStartSnoozedForSession = false;
      await autoStartCoordinator.evaluate('browser-start');
    },
    onExtensionUpdate: handleExtensionUpdate,
    onAlarm: () => farmingSession.checkDropProgress(),
    onAutomationAlarm: () => autoStartCoordinator.evaluate('periodic'),
    onLinkRecheckAlarm: () => farmingSession.handleRefreshDrops(),
    onManagedTabRemoved: (removedTabId) => handleManagedTabRemoved(removedTabId),
    onManagedTabNavigatedAway: (updatedTabId, url) => handleManagedTabNavigatedAway(updatedTabId, url),
    onMonitorWindowRemoved: (removedWindowId) => handleMonitorWindowRemoved(removedWindowId),
    logWarn,
  });

  registerRuntimeMessageRouter(
    {
      ensureGamesCache: (message) => handleEnsureGamesCache(state, message.payload, ensureGamesCacheDeps),
      openDropsPageAndRefresh: (message) => openDropsPageAndRefresh(message),
      markDropsRefreshNoticeSeen: (message) => handleMarkDropsRefreshNoticeSeen(message.payload),
      addToQueue: (message) => farmingSession.handleAddToQueue(message.payload),
      removeFromQueue: (message) => farmingSession.handleRemoveFromQueue(message.payload),
      reorderQueue: (message) => farmingSession.handleReorderQueue(message.payload),
      clearQueue: () => farmingSession.handleClearQueue(),
      startFarming: (message) => farmingSession.handleStartFarming(message.payload),
      setSelectedGame: (message) => farmingSession.handleSetSelectedGame(message.payload),
      pauseFarming: async () => {
        autoStartSnoozedForSession = true;
        await setAutoStartSnoozed();
        return farmingSession.handlePauseFarming();
      },
      setAutoResumeOnStartup: (message) => handleSetAutoResumeOnStartup(message.payload),
      resumeFarming: () => farmingSession.handleResumeFarming(),
      stopFarming: async () => {
        autoStartSnoozedForSession = true;
        await setAutoStartSnoozed();
        return farmingSession.handleStopFarming();
      },
      updateGames: (message) => handleUpdateGames(message.payload),
      syncTwitchSession: (message, sender) => handleSyncTwitchSession(message.payload, sender),
      syncTwitchIntegrity: (message, sender) => handleSyncTwitchIntegrity(message.payload, sender),
      refreshDrops: () => farmingSession.handleRefreshDrops(),
      setMonitorAutoOpen: (message) => handleSetMonitorAutoOpen(message.payload),
      setMuteFarmingTab: (message) => handleSetMuteFarmingTab(message.payload),
      setNotificationsEnabled: (message) => handleSetNotificationsEnabled(message.payload),
      setTelegramAlertsEnabled: (message) => handleSetTelegramAlertsEnabled(message.payload),
      setTelegramCredentials: (message) => handleSetTelegramCredentials(message.payload),
      testTelegramAlerts: () => handleTestTelegramAlerts(),
      getTelegramSettings: () => handleGetTelegramSettings(),
      setAutoClaimChannelPointsBonus: (message) => handleSetAutoClaimChannelPointsBonus(message.payload),
      channelPointsBonusClaimed: (message, sender) =>
        handleChannelPointsBonusClaimed(message.payload, sender),
      setAutoClaimDrops: (message) => handleSetAutoClaimDrops(message.payload),
      setStreamerSelectionMode: (message) => handleSetStreamerSelectionMode(message.payload),
      setPreferredStreamerLanguage: (message) => handleSetPreferredStreamerLanguage(message.payload),
      setGameFavorite: (message) => handleSetGameFavorite(message.payload),
      setCampaignPriorityMode: (message) => handleSetCampaignPriorityMode(message.payload),
      setFarmCategoryScope: (message) => handleSetFarmCategoryScope(message.payload),
      setAutoStartFavorites: (message) => handleSetAutoStartFavorites(message.payload),
      setWatchTransportMode: (message) => handleSetWatchTransportMode(message.payload),
      evaluateAutoStart: () => handleEvaluateAutoStart(),
      openMonitorDashboard: (message) => openMonitorDashboardWindow(message.payload ?? {}),
      getClaimLog: () => handleGetClaimLog(),
      clearClaimLog: () => handleClearClaimLog(),
    },
    {
      beforeHandle: async () => {
        if (initPromise) {
          await initPromise;
        }
      },
    },
  );

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
