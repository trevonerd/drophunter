import { browser } from '../shared/browser-api.ts';
import { replaceAvailableGames } from '../shared/game-selection.ts';
import { clearRecoveryStatus, clearTerminalStopStatus } from '../shared/runtime-status.ts';
import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import type { TwitchGame } from '../types/index.ts';
import {
  attemptAutoClaimChannelPointsBonusExt,
  recordChannelPointsBonusClaimedExt,
} from './channel-points.ts';
import { createDropsPageRefresher } from './drops-page-refresh.ts';
import {
  annotateGameCompletion,
  clearSelectedCompletedIdleCampaignExt,
  normalizeGameSelection,
  recordEmptyCampaignObservation,
  resetStateForAuthoritativeEmptyCampaignExt,
  splitDropsForSelectedGame,
} from './drops-projection.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import type { createFarmingSession } from './farming-session.ts';
import {
  type EnsureGamesCacheDeps,
  type GamesCacheRefreshDeps,
  handleEnsureGamesCache,
  refreshGamesCacheFromHiddenFetch,
} from './games-cache-orchestration.ts';
import { logDebug } from './logging.ts';
import { normalizeQueueSelection } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import type { createServiceWorkerTwitchGateway } from './service-worker-twitch-gateway.ts';
import { resetStreamTrackingState } from './session-lifecycle.ts';
import {
  syncTwitchIntegrityFromContentScriptExt,
  syncTwitchSessionFromContentScriptExt,
} from './session-management.ts';
import {
  broadcastStateUpdate,
  saveState,
  saveTimingState,
  shouldRefreshGamesCache,
} from './state-persistence.ts';
import { waitForTabComplete } from './tab-management.ts';

type FarmingSession = Pick<ReturnType<typeof createFarmingSession>, 'resumeAfterAuthRecovery' | 'stop'>;
type StateLifecycle = Pick<
  ReturnType<typeof createServiceWorkerStateLifecycle>,
  'awaitInitialization' | 'ensureStateHydratedForCache' | 'getInitPromise' | 'trackActivity'
>;
type TwitchGateway = Pick<
  ReturnType<typeof createServiceWorkerTwitchGateway>,
  | 'ensureContentScriptOnTab'
  | 'fetchDropsSnapshot'
  | 'fetchDropsSnapshotProgressively'
  | 'persistSessionFromDropsPage'
  | 'shouldRefreshCampaignsAfterSessionSync'
>;

interface ServiceWorkerContentDependencies {
  readonly automation: FarmingAutomation;
  readonly farmingSession: FarmingSession;
  readonly stateLifecycle: StateLifecycle;
  readonly twitchGateway: TwitchGateway;
  readonly notify: (title: string, message: string, priority?: number) => Promise<void>;
}

export type TwitchSessionRecoveryIntent = 'none' | 'continue' | 'resume';

export function twitchSessionRecoveryIntent(
  appState: Pick<ServiceWorkerState['appState'], 'lastStopReason' | 'recoveryReason'>,
): TwitchSessionRecoveryIntent {
  if (appState.lastStopReason === 'sign-in-required') return 'resume';
  if (appState.recoveryReason === 'sign-in-required') return 'continue';
  return 'none';
}

export function createServiceWorkerContentHandlers(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerContentDependencies,
) {
  const gamesCacheRefreshDependencies: GamesCacheRefreshDeps = {
    fetchDropsSnapshot: dependencies.twitchGateway.fetchDropsSnapshot,
    fetchDropsSnapshotProgressively: dependencies.twitchGateway.fetchDropsSnapshotProgressively,
    onProgressiveSnapshotApplied: () => {
      void dependencies.automation.request('campaign-refresh').catch((error) => {
        logDebug('Progressive favorite auto-start evaluation failed', { error: String(error) });
      });
    },
    replaceAvailableGames,
    annotateGameCompletion,
    normalizeGameSelection,
    normalizeQueueSelection,
    splitDropsForSelectedGame,
    recordEmptyCampaignObservation,
    resetStateForAuthoritativeEmptyCampaign: resetStateForAuthoritativeEmptyCampaignExt,
    clearSelectedCompletedIdleCampaign: clearSelectedCompletedIdleCampaignExt,
    resetStreamTrackingState,
    clearRecoveryStatus,
    clearTerminalStopStatus,
    stopFarmingSession: (options) => dependencies.farmingSession.stop(options),
    saveState,
  };
  const refreshGamesCache = (options: Parameters<typeof refreshGamesCacheFromHiddenFetch>[1]) =>
    refreshGamesCacheFromHiddenFetch(state, options, gamesCacheRefreshDependencies);
  const ensureGamesCacheDependencies: EnsureGamesCacheDeps = {
    awaitInitPromise: dependencies.stateLifecycle.getInitPromise,
    trackActivity: dependencies.stateLifecycle.trackActivity,
    ensureStateHydratedForCache: dependencies.stateLifecycle.ensureStateHydratedForCache,
    shouldRefreshGamesCache,
    refreshGamesCacheFromHiddenFetch: refreshGamesCache,
    saveState,
  };
  const dropsPageRefresher = createDropsPageRefresher(state, {
    trackActivity: dependencies.stateLifecycle.trackActivity,
    ensureStateHydratedForCache: dependencies.stateLifecycle.ensureStateHydratedForCache,
    waitForTabComplete,
    persistSessionFromDropsPage: dependencies.twitchGateway.persistSessionFromDropsPage,
    refreshGamesCacheFromHiddenFetch: refreshGamesCache,
    saveState: () => saveState(state),
    broadcastStateUpdate,
  });

  async function ensureGamesCache(payload?: { readonly force?: boolean }) {
    return handleEnsureGamesCache(state, payload, ensureGamesCacheDependencies);
  }

  async function openDropsPageAndRefresh(message?: {
    readonly payload?: { readonly waitForRefresh?: boolean; readonly active?: boolean };
  }) {
    await dependencies.stateLifecycle.awaitInitialization();
    return dropsPageRefresher.openDropsPageAndRefresh({
      waitForRefresh: message?.payload?.waitForRefresh,
      active: message?.payload?.active,
    });
  }

  async function recordChannelPointsBonusClaimed(channelName?: string | null): Promise<void> {
    await recordChannelPointsBonusClaimedExt(
      state.appState,
      {
        saveState: () => saveState(state),
        notify: dependencies.notify,
        awaitInit: dependencies.stateLifecycle.awaitInitialization,
      },
      channelName,
    );
  }

  async function attemptAutoClaimChannelPointsBonus() {
    return attemptAutoClaimChannelPointsBonusExt(state.appState, {
      ensureContentScriptOnTab: dependencies.twitchGateway.ensureContentScriptOnTab,
      sendMessageToTab: (tabId: number, message: unknown) =>
        browser.tabs.sendMessage(tabId, message).catch(() => null),
      getTab: (tabId: number) => browser.tabs.get(tabId).catch(() => null),
      recordBonusClaimed: recordChannelPointsBonusClaimed,
    });
  }

  async function handleUpdateGames(payload?: TwitchGame[]) {
    state.appState.availableGames = replaceAvailableGames(payload ?? []);
    state.appState.availableGames = annotateGameCompletion(
      state.appState.availableGames,
      state.cachedDropsSnapshot,
    );
    if (state.appState.availableGames.length > 0) state.appState.lastSuccessfulRefreshAt = Date.now();
    normalizeGameSelection(state, state.appState.availableGames, true);
    normalizeQueueSelection(state, state.appState.availableGames, true);
    await saveState(state);
    saveTimingState(state).catch(() => undefined);
    await dependencies.automation.request('campaign-refresh');
    return { success: true };
  }

  function isTrustedTwitchSender(sender: chrome.runtime.MessageSender): boolean {
    const url = sender.tab?.url ?? sender.url ?? '';
    if (getFarmableTwitchChannelNameFromUrl(url) !== null) return true;
    try {
      const parsed = new URL(url);
      return (
        /(^|\.)twitch\.tv$/i.test(parsed.hostname) && /^\/drops\/campaigns(?:\/|$)/i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  }

  function sessionPayloadCandidate(payload: unknown): unknown {
    return payload && typeof payload === 'object' && 'session' in payload ? payload.session : payload;
  }

  async function handleSyncTwitchSession(payload: unknown, sender: chrome.runtime.MessageSender) {
    if (!isTrustedTwitchSender(sender)) return { success: false, error: 'Untrusted message sender' };
    await dependencies.stateLifecycle.awaitInitialization();
    const recoveryIntent = twitchSessionRecoveryIntent(state.appState);
    const result = await syncTwitchSessionFromContentScriptExt(
      state,
      sessionPayloadCandidate(payload),
      sender.tab?.id,
      {
        shouldRefreshCampaignsAfterSessionSync:
          dependencies.twitchGateway.shouldRefreshCampaignsAfterSessionSync,
        onRefreshCampaigns: () => refreshGamesCache({ requireConsecutiveEmptyConfirmation: true }),
        onSaveState: () => saveState(state),
        onBroadcastStateUpdate: () => broadcastStateUpdate(state.appState),
      },
    );
    if (!result.success || recoveryIntent === 'none') {
      return result;
    }

    state.apiConsecutiveFailures = 0;
    state.apiBackoffUntil = 0;
    state.recoveryBackoffUntil = 0;
    state.lastRecoveryAttemptAt = 0;
    state.recoveryNotificationSent = false;
    state.appState = clearRecoveryStatus(clearTerminalStopStatus(state.appState));
    switch (recoveryIntent) {
      case 'resume':
        await dependencies.farmingSession.resumeAfterAuthRecovery();
        break;
      case 'continue':
        await saveState(state);
        break;
      default:
        recoveryIntent satisfies never;
    }
    return result;
  }

  async function handleSyncTwitchIntegrity(
    payload:
      | { readonly token?: string; readonly expiration?: number; readonly request_id?: string }
      | undefined,
    sender: chrome.runtime.MessageSender | undefined,
  ) {
    if (!sender || !isTrustedTwitchSender(sender)) {
      return { success: false, error: 'Untrusted message sender' };
    }
    return syncTwitchIntegrityFromContentScriptExt(state, payload);
  }

  async function handleChannelPointsBonusClaimed(
    payload: { readonly channelName?: string | null } | undefined,
    sender: chrome.runtime.MessageSender,
  ) {
    if (!isTrustedTwitchSender(sender)) return { success: false, error: 'Untrusted message sender' };
    logDebug('Channel points bonus claimed by content script', { tabId: sender.tab?.id });
    const channelName =
      payload?.channelName ?? getFarmableTwitchChannelNameFromUrl(sender.tab?.url ?? '') ?? null;
    await recordChannelPointsBonusClaimed(channelName);
    return { success: true };
  }

  return {
    attemptAutoClaimChannelPointsBonus,
    ensureGamesCache,
    handleChannelPointsBonusClaimed,
    handleSyncTwitchIntegrity,
    handleSyncTwitchSession,
    handleUpdateGames,
    openDropsPageAndRefresh,
  };
}
