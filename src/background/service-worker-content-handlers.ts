import { browser } from '../shared/browser-api.ts';
import { replaceAvailableGames } from '../shared/game-selection.ts';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../shared/runtime-status.ts';
import type { ActivationTrigger } from '../types/index.ts';
import { createActivationSyncCoordinator } from './activation-sync-coordinator.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import { persistCampaignSyncState } from './campaign-sync-state.ts';
import { CAMPAIGN_SYNC_RETRY_ALARM_NAME } from './constants.ts';
import { createDropsPageRefresher } from './drops-page-refresh.ts';
import {
  annotateGameCompletion,
  clearSelectedCompletedIdleCampaignExt,
  normalizeGameSelection,
  resetStateForAuthoritativeEmptyCampaignExt,
  splitDropsForSelectedGame,
} from './drops-projection.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import type { createFarmingSession } from './farming-session.ts';
import { type GamesCacheRefreshDeps, refreshGamesCacheFromHiddenFetch } from './games-cache-orchestration.ts';
import { queueCleanupNotification } from './queue-availability-cleanup-activity.ts';
import { normalizeQueueSelection } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { createServiceWorkerActivationSync } from './service-worker-activation-sync.ts';
import { createServiceWorkerContentUtilities } from './service-worker-content-utilities.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import { createServiceWorkerTwitchContentHandlers } from './service-worker-twitch-content-handlers.ts';
import type { createServiceWorkerTwitchGateway } from './service-worker-twitch-gateway.ts';
import { resetStreamTrackingState } from './session-lifecycle.ts';
import { broadcastStateUpdate, saveState, saveTimingState } from './state-persistence.ts';
import { waitForTabComplete } from './tab-management.ts';

type FarmingSession = Pick<
  ReturnType<typeof createFarmingSession>,
  | 'acquireStreamerForSelectedGame'
  | 'advanceQueueIfCompleted'
  | 'handleAuthoritativeCampaignUnavailable'
  | 'handleStartFarming'
  | 'resumeAfterAuthRecovery'
  | 'stop'
>;
type StateLifecycle = Pick<
  ReturnType<typeof createServiceWorkerStateLifecycle>,
  'awaitInitialization' | 'ensureStateHydratedForCache' | 'getInitPromise' | 'trackActivity'
>;
type TwitchGateway = Pick<
  ReturnType<typeof createServiceWorkerTwitchGateway>,
  | 'ensureContentScriptOnTab'
  | 'fetchDropsSnapshot'
  | 'fetchDropsSnapshotProgressively'
  | 'getLastTwitchApiFailure'
  | 'persistSessionFromDropsPage'
  | 'shouldRefreshCampaignsAfterSessionSync'
>;

interface ServiceWorkerContentDependencies {
  readonly automation: FarmingAutomation;
  readonly farmingSession: FarmingSession;
  readonly stateLifecycle: StateLifecycle;
  readonly twitchGateway: TwitchGateway;
  readonly notify: (title: string, message: string, priority?: number) => Promise<void>;
  readonly clearQueueCompleteNotification: () => Promise<void>;
  readonly automationNotify?: AutomationEventNotifier['notify'];
}

export type { TwitchSessionRecoveryIntent } from './service-worker-twitch-content-handlers.ts';
export { twitchSessionRecoveryIntent } from './service-worker-twitch-content-handlers.ts';

export function createServiceWorkerContentHandlers(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerContentDependencies,
) {
  const gamesCacheRefreshDependencies: GamesCacheRefreshDeps = {
    fetchDropsSnapshot: dependencies.twitchGateway.fetchDropsSnapshot,
    fetchDropsSnapshotProgressively: dependencies.twitchGateway.fetchDropsSnapshotProgressively,
    getLastTwitchApiFailure: dependencies.twitchGateway.getLastTwitchApiFailure,
    replaceAvailableGames,
    annotateGameCompletion,
    normalizeGameSelection,
    normalizeQueueSelection,
    splitDropsForSelectedGame,
    resetStateForAuthoritativeEmptyCampaign: resetStateForAuthoritativeEmptyCampaignExt,
    clearSelectedCompletedIdleCampaign: clearSelectedCompletedIdleCampaignExt,
    resetStreamTrackingState,
    clearRecoveryStatus,
    clearTerminalStopStatus,
    onAuthoritativeCampaignUnavailable: (game) =>
      dependencies.farmingSession.handleAuthoritativeCampaignUnavailable(game),
    onQueueCampaignsRemoved: async (result) => {
      const notification = queueCleanupNotification(result);
      await dependencies.automationNotify?.({
        transitionId: notification.transitionId,
        event: 'queue-cleanup',
        campaignId: 'queue',
        telegramReason: 'queue-cleanup',
        title: 'Queue updated',
        message: notification.message,
      });
    },
    stopFarmingSession: (options) => dependencies.farmingSession.stop(options),
    saveState,
  };
  const refreshGamesCache = (options: Parameters<typeof refreshGamesCacheFromHiddenFetch>[1]) =>
    refreshGamesCacheFromHiddenFetch(state, options, gamesCacheRefreshDependencies);
  const dropsPageRefresher = createDropsPageRefresher(state, {
    trackActivity: dependencies.stateLifecycle.trackActivity,
    ensureStateHydratedForCache: dependencies.stateLifecycle.ensureStateHydratedForCache,
    waitForTabComplete,
    persistSessionFromDropsPage: dependencies.twitchGateway.persistSessionFromDropsPage,
    refreshGamesCacheFromHiddenFetch: refreshGamesCache,
    saveState: () => saveState(state),
    broadcastStateUpdate,
  });

  const publishCampaignSyncState = (campaignSyncState: Parameters<typeof persistCampaignSyncState>[1]) =>
    persistCampaignSyncState(state, campaignSyncState, {
      save: saveState,
      broadcast: broadcastStateUpdate,
      notifyAutomation: dependencies.automationNotify,
    });

  const activationSyncCoordinator = createActivationSyncCoordinator({
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: publishCampaignSyncState,
    scheduleRetry: async (retryAt) => {
      browser.alarms.create(CAMPAIGN_SYNC_RETRY_ALARM_NAME, { when: retryAt });
    },
    clearRetry: () => browser.alarms.clear(CAMPAIGN_SYNC_RETRY_ALARM_NAME).then(() => undefined),
    shouldRunPeriodicSync: () => state.appState.isRunning || state.appState.autoStartFavoriteGames,
    performSync: createServiceWorkerActivationSync({
      automation: dependencies.automation,
      clearQueueCompleteNotification: dependencies.clearQueueCompleteNotification,
      dropsPageRefresher,
      farmingSession: dependencies.farmingSession,
      hasCompletedOnboarding: async () => {
        const stored: Record<string, unknown> = await browser.storage.local
          .get('onboardingCompleted')
          .catch(() => ({}));
        return stored.onboardingCompleted === true;
      },
      refreshGamesCache,
      state,
    }),
  });

  async function requestActivationSync(trigger: ActivationTrigger) {
    await dependencies.stateLifecycle.awaitInitialization();
    const now = Date.now();
    const previousLifecycleCheckAt = state.lastLifecycleCheckAt;
    state.lastLifecycleCheckAt = now;
    void saveTimingState(state);
    const effectiveTrigger =
      trigger !== 'manual' &&
      trigger !== 'popup-open' &&
      trigger !== 'extension-update' &&
      previousLifecycleCheckAt > 0 &&
      now - previousLifecycleCheckAt > 2 * 60_000
        ? 'wake'
        : trigger;
    return activationSyncCoordinator.request(effectiveTrigger);
  }

  const activatePopup = () => requestActivationSync('popup-open');
  const initializeActivationSync = () => activationSyncCoordinator.initialize();
  const openDropsAndSync = () => requestActivationSync('manual');

  async function ensureGamesCache(payload?: { readonly force?: boolean }) {
    const result = await requestActivationSync(payload?.force ? 'manual-retry' : 'popup-open');
    return {
      success: result.kind !== 'needs-session' && result.kind !== 'retry-scheduled',
      refreshed: result.kind === 'synced',
      gamesCount: state.appState.availableGames.length,
      games: state.appState.availableGames,
      ...(result.kind === 'retry-scheduled' ? { error: result.error } : {}),
    };
  }

  async function refreshDrops() {
    await requestActivationSync('worker-start');
    // One-release compatibility adapter: the legacy command only acknowledged
    // that refresh work was scheduled. Detailed state is exposed by ACTIVATE_POPUP.
    return { success: true };
  }

  async function openDropsPageAndRefresh(_message?: {
    readonly payload?: { readonly waitForRefresh?: boolean; readonly active?: boolean };
  }) {
    const result = await openDropsAndSync();
    return {
      success: result.kind === 'synced' || result.kind === 'cache-fresh',
      opened: true,
      refreshed: result.kind === 'synced',
      gamesCount: state.appState.availableGames.length,
      appState: state.appState,
      ...(result.kind === 'needs-session'
        ? { error: 'Open Twitch Drops so DropHunter can detect your session.' }
        : result.kind === 'retry-scheduled'
          ? { error: result.error }
          : {}),
    };
  }

  const contentUtilities = createServiceWorkerContentUtilities(state, {
    automation: dependencies.automation,
    notify: dependencies.notify,
    awaitInitialization: dependencies.stateLifecycle.awaitInitialization,
    ensureContentScriptOnTab: dependencies.twitchGateway.ensureContentScriptOnTab,
  });

  const twitchContentHandlers = createServiceWorkerTwitchContentHandlers(state, {
    awaitInitialization: dependencies.stateLifecycle.awaitInitialization,
    shouldRefreshCampaignsAfterSessionSync: dependencies.twitchGateway.shouldRefreshCampaignsAfterSessionSync,
    requestAuthRecoveredSync: () => requestActivationSync('auth-recovered'),
    resumeAfterAuthRecovery: dependencies.farmingSession.resumeAfterAuthRecovery,
    recordChannelPointsBonusClaimed: contentUtilities.recordChannelPointsBonusClaimed,
  });

  return {
    activatePopup,
    attemptAutoClaimChannelPointsBonus: contentUtilities.attemptAutoClaimChannelPointsBonus,
    ensureGamesCache,
    getAppState: () => state.appState,
    ...twitchContentHandlers,
    handleUpdateGames: contentUtilities.handleUpdateGames,
    initializeActivationSync,
    openDropsAndSync,
    openDropsPageAndRefresh,
    refreshDrops,
    requestActivationSync,
  };
}
