import { isFavoriteGame } from '../shared/game-selection.ts';
import type { TwitchGame, WatchTransportMode } from '../types/index.ts';
import { applyAutoClaimDropsSetting } from './auto-claim.ts';
import { applyAutoClaimChannelPointsBonusSetting } from './channel-points.ts';
import { clearClaimLog, loadClaimLog } from './claim-log.ts';
import type { FarmingAutomation, FarmingAutomationOutcome } from './farming-automation.ts';
import { setGameFavorite } from './favorite-games.ts';
import type { createNotificationController } from './notifications.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import { saveState } from './state-persistence.ts';
import {
  applyPreferredStreamerLanguageSetting,
  applyStreamerSelectionModeSetting,
} from './streamer-selection.ts';
import { syncManagedTabMuteState } from './tab-management.ts';
import { type createTelegramNotifier, getTelegramSettingsSummary } from './telegram-notifications.ts';

type BrowserEvents = Pick<ReturnType<typeof createServiceWorkerBrowserEvents>, 'watchTransport'>;
type NotificationController = Pick<
  ReturnType<typeof createNotificationController>,
  'setNotificationsEnabled'
>;
type StateLifecycle = Pick<
  ReturnType<typeof createServiceWorkerStateLifecycle>,
  'awaitInitialization' | 'trackActivity'
>;
type TelegramNotifier = Pick<
  ReturnType<typeof createTelegramNotifier>,
  'sendTestAlert' | 'setTelegramAlertsEnabled' | 'setTelegramCredentials'
>;

interface ServiceWorkerSettingsDependencies {
  readonly automation: FarmingAutomation;
  readonly browserEvents: BrowserEvents;
  readonly notificationController: NotificationController;
  readonly stateLifecycle: StateLifecycle;
  readonly telegramNotifier: TelegramNotifier;
}

function mapExplicitAutomationOutcome(outcome: FarmingAutomationOutcome) {
  switch (outcome.kind) {
    case 'started':
      return { success: true, started: true, reason: 'Campaign started automatically.' } as const;
    case 'unchanged':
      return { success: true, started: false, reason: outcome.reason } as const;
    case 'failed':
      return { success: false, started: false, error: outcome.reason } as const;
    default:
      return outcome satisfies never;
  }
}

export function createServiceWorkerSettingsHandlers(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerSettingsDependencies,
) {
  const trackActivity = dependencies.stateLifecycle.trackActivity;

  async function handleSetMonitorAutoOpen(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-monitor-auto-open');
    state.appState.monitorAutoOpen = payload?.enabled !== false;
    await saveState(state);
    return { success: true, monitorAutoOpen: state.appState.monitorAutoOpen };
  }

  async function handleSetAutoResumeOnStartup(payload?: { readonly enabled?: boolean }) {
    await dependencies.stateLifecycle.awaitInitialization();
    await trackActivity('set-auto-resume-on-startup');
    state.appState.autoResumeOnStartup = payload?.enabled === true;
    await saveState(state);
    return { success: true, autoResumeOnStartup: state.appState.autoResumeOnStartup };
  }

  async function handleSetGameFavorite(payload: { readonly game: TwitchGame; readonly favorite: boolean }) {
    await trackActivity('set-game-favorite');
    const result = setGameFavorite(state.appState, payload.game, payload.favorite, Date.now());
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
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
    readonly mode: 'ending-soonest' | 'lowest-availability' | 'priority-list-only';
  }) {
    await trackActivity('set-campaign-priority-mode');
    state.appState.campaignPriorityMode = payload.mode;
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return { success: true, campaignPriorityMode: state.appState.campaignPriorityMode };
  }

  async function handleSetFarmCategoryScope(payload: { readonly scope: 'all' | 'favorites-only' }) {
    await trackActivity('set-farm-category-scope');
    state.appState.farmCategoryScope = payload.scope;
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return { success: true, farmCategoryScope: state.appState.farmCategoryScope };
  }

  async function handleSetAutoStartFavorites(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-auto-start-favorites');
    if (payload?.enabled !== true) {
      state.appState.autoStartFavoriteGames = false;
      await saveState(state);
      await dependencies.automation.request('campaign-refresh');
      return { success: true, autoStartFavoriteGames: false };
    }
    const result = await dependencies.notificationController.setNotificationsEnabled(true);
    state.appState.autoStartFavoriteGames = result.success;
    await saveState(state);
    await dependencies.automation.request('campaign-refresh');
    return {
      success: result.success,
      autoStartFavoriteGames: state.appState.autoStartFavoriteGames,
      error: result.error,
    };
  }

  async function handleSetWatchTransportMode(payload: { readonly mode: WatchTransportMode }) {
    await trackActivity('set-watch-transport-mode');
    const transport = dependencies.browserEvents.watchTransport;
    const currentStreamer = state.appState.activeStreamer;
    if (state.appState.isRunning && !state.appState.isPaused && currentStreamer) await transport.stop();
    await transport.setPreference(payload.mode);
    if (state.appState.isRunning && !state.appState.isPaused && currentStreamer) {
      await transport.start(currentStreamer);
    }
    return { success: true, watchTransportPreference: state.appState.watchTransportPreference };
  }

  async function handleEvaluateAutoStart() {
    return mapExplicitAutomationOutcome(await dependencies.automation.request('user-request'));
  }

  async function handleSetMuteFarmingTab(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-mute-farming-tab');
    state.appState.muteFarmingTab = payload?.enabled !== false;
    await Promise.all([saveState(state), syncManagedTabMuteState(state)]);
    return { success: true, muteFarmingTab: state.appState.muteFarmingTab };
  }

  async function handleSetNotificationsEnabled(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-notifications-enabled');
    const result = await dependencies.notificationController.setNotificationsEnabled(
      payload?.enabled !== false,
    );
    if (!result.notificationsEnabled && state.appState.autoStartFavoriteGames) {
      state.appState.autoStartFavoriteGames = false;
      await saveState(state);
    }
    return result;
  }

  async function handleGetTelegramSettings() {
    try {
      return { success: true, ...(await getTelegramSettingsSummary()) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async function handleSetAutoClaimChannelPointsBonus(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-auto-claim-channel-points-bonus');
    state.appState = applyAutoClaimChannelPointsBonusSetting(state.appState, payload?.enabled);
    await saveState(state);
    return { success: true, autoClaimChannelPointsBonus: state.appState.autoClaimChannelPointsBonus };
  }

  async function handleSetAutoClaimDrops(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-auto-claim-drops');
    state.appState = applyAutoClaimDropsSetting(state.appState, payload?.enabled);
    await saveState(state);
    return { success: true, autoClaimDrops: state.appState.autoClaimDrops };
  }

  async function handleSetStreamerSelectionMode(payload?: {
    readonly mode?: 'low-view' | 'random' | 'top-viewers';
  }) {
    await trackActivity('set-streamer-selection-mode');
    state.appState = applyStreamerSelectionModeSetting(state.appState, payload?.mode);
    await saveState(state);
    return { success: true, streamerSelectionMode: state.appState.streamerSelectionMode };
  }

  async function handleSetPreferredStreamerLanguage(payload?: { readonly language?: string | null }) {
    await trackActivity('set-preferred-streamer-language');
    state.appState = applyPreferredStreamerLanguageSetting(state.appState, payload?.language);
    await saveState(state);
    return { success: true, preferredStreamerLanguage: state.appState.preferredStreamerLanguage };
  }

  return {
    handleClearClaimLog: async () => {
      try {
        await clearClaimLog();
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    handleEvaluateAutoStart,
    handleGetClaimLog: async () => {
      try {
        return { success: true, entries: await loadClaimLog() };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    handleGetTelegramSettings,
    handleSetAutoClaimChannelPointsBonus,
    handleSetAutoClaimDrops,
    handleSetAutoResumeOnStartup,
    handleSetAutoStartFavorites,
    handleSetCampaignPriorityMode,
    handleSetFarmCategoryScope,
    handleSetGameFavorite,
    handleSetMonitorAutoOpen,
    handleSetMuteFarmingTab,
    handleSetNotificationsEnabled,
    handleSetPreferredStreamerLanguage,
    handleSetStreamerSelectionMode,
    handleSetTelegramAlertsEnabled: async (payload?: { readonly enabled?: boolean }) => {
      await trackActivity('set-telegram-alerts-enabled');
      return dependencies.telegramNotifier.setTelegramAlertsEnabled(payload?.enabled !== false);
    },
    handleSetTelegramCredentials: async (payload?: {
      readonly botToken?: string;
      readonly chatId?: string;
      readonly clearToken?: boolean;
    }) => {
      await trackActivity('set-telegram-credentials');
      return dependencies.telegramNotifier.setTelegramCredentials(payload ?? {});
    },
    handleSetWatchTransportMode,
    handleTestTelegramAlerts: async () => {
      await trackActivity('test-telegram-alerts');
      return dependencies.telegramNotifier.sendTestAlert();
    },
  };
}
