import { applyAutoClaimDropsSetting } from './auto-claim.ts';
import { applyAutoClaimChannelPointsBonusSetting } from './channel-points.ts';
import { clearClaimLog, loadClaimLog } from './claim-log.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  createServiceWorkerAutomationSettingsHandlers,
  type ServiceWorkerAutomationSettingsDependencies,
} from './service-worker-automation-settings.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import { saveState } from './state-persistence.ts';
import {
  applyPreferredStreamerLanguageSetting,
  applyStreamerSelectionModeSetting,
} from './streamer-selection.ts';
import { syncManagedTabMuteState } from './tab-management.ts';
import { type createTelegramNotifier, getTelegramSettingsSummary } from './telegram-notifications.ts';

type StateLifecycle = Pick<
  ReturnType<typeof createServiceWorkerStateLifecycle>,
  'awaitInitialization' | 'trackActivity'
>;
type TelegramNotifier = Pick<
  ReturnType<typeof createTelegramNotifier>,
  'sendTestAlert' | 'setTelegramAlertsEnabled' | 'setTelegramCredentials'
>;

interface ServiceWorkerSettingsDependencies extends ServiceWorkerAutomationSettingsDependencies {
  readonly stateLifecycle: StateLifecycle;
  readonly telegramNotifier: TelegramNotifier;
}

export function createServiceWorkerSettingsHandlers(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerSettingsDependencies,
) {
  const trackActivity = dependencies.stateLifecycle.trackActivity;
  const automationSettings = createServiceWorkerAutomationSettingsHandlers(state, dependencies);

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
    ...automationSettings,
    handleClearClaimLog: async () => {
      try {
        await clearClaimLog();
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
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
    handleSetMonitorAutoOpen,
    handleSetMuteFarmingTab,
    handleSetNotificationsEnabled,
    handleSetPreferredStreamerLanguage,
    handleSetStreamerSelectionMode,
    handleSetTelegramAlertsEnabled: async (payload?: { readonly enabled?: boolean }) => {
      await trackActivity('set-telegram-alerts-enabled');
      return dependencies.telegramNotifier.setTelegramAlertsEnabled(payload?.enabled !== false);
    },
    handleSetTelegramSystemAlertsEnabled: async (payload?: { readonly enabled?: boolean }) => {
      await trackActivity('set-telegram-system-alerts-enabled');
      state.appState.telegramSystemAlertsEnabled = payload?.enabled !== false;
      await saveState(state);
      return { success: true, telegramSystemAlertsEnabled: state.appState.telegramSystemAlertsEnabled };
    },
    handleSetTelegramCredentials: async (payload?: {
      readonly botToken?: string;
      readonly chatId?: string;
      readonly clearToken?: boolean;
    }) => {
      await trackActivity('set-telegram-credentials');
      return dependencies.telegramNotifier.setTelegramCredentials(payload ?? {});
    },
    handleTestTelegramAlerts: async () => {
      await trackActivity('test-telegram-alerts');
      return dependencies.telegramNotifier.sendTestAlert();
    },
  };
}
