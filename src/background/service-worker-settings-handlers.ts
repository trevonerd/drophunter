import { applyAutoClaimDropsSetting } from './auto-claim.ts';
import { applyAutoClaimChannelPointsBonusSetting } from './channel-points.ts';
import { clearClaimLog, loadClaimLog } from './claim-log.ts';
import type { createNotificationController } from './notifications.ts';
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
import { createTwitchAdblockController } from './twitch-adblock.ts';

type StateLifecycle = Pick<
  ReturnType<typeof createServiceWorkerStateLifecycle>,
  'awaitInitialization' | 'trackActivity'
>;
type TelegramNotifier = Pick<
  ReturnType<typeof createTelegramNotifier>,
  'sendTestAlert' | 'setTelegramAlertsEnabled' | 'setTelegramCredentials'
>;
type NotificationController = Pick<
  ReturnType<typeof createNotificationController>,
  'setNotificationsEnabled'
>;

interface ServiceWorkerSettingsDependencies extends ServiceWorkerAutomationSettingsDependencies {
  readonly stateLifecycle: StateLifecycle;
  readonly telegramNotifier: TelegramNotifier;
  readonly notificationController: NotificationController;
}

export function createServiceWorkerSettingsHandlers(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerSettingsDependencies,
) {
  const trackActivity = dependencies.stateLifecycle.trackActivity;
  const automationSettings = createServiceWorkerAutomationSettingsHandlers(state, dependencies);
  const twitchAdblock = createTwitchAdblockController(state);

  async function handleSetMonitorAutoOpen(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-monitor-auto-open');
    await saveState(state, {
      updateAppState: (appState) => ({ ...appState, monitorAutoOpen: payload?.enabled !== false }),
    });
    return { success: true, monitorAutoOpen: state.appState.monitorAutoOpen };
  }

  async function handleSetMuteFarmingTab(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-mute-farming-tab');
    await saveState(state, {
      updateAppState: (appState) => ({ ...appState, muteFarmingTab: payload?.enabled !== false }),
    });
    await syncManagedTabMuteState(state);
    return { success: true, muteFarmingTab: state.appState.muteFarmingTab };
  }

  async function handleSetNotificationsEnabled(payload?: { readonly enabled?: boolean }) {
    const revision = state.optionalPermissionRevisions.notificationsEnabled;
    await trackActivity('set-notifications-enabled');
    const isCurrent = () => state.optionalPermissionRevisions.notificationsEnabled === revision;
    if (!isCurrent()) return { success: false, error: 'Setting changed while permission was pending' };
    const result = await dependencies.notificationController.setNotificationsEnabled(
      payload?.enabled !== false,
      isCurrent,
    );
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
    await saveState(state, {
      updateAppState: (appState) => applyAutoClaimChannelPointsBonusSetting(appState, payload?.enabled),
    });
    return { success: true, autoClaimChannelPointsBonus: state.appState.autoClaimChannelPointsBonus };
  }

  async function handleSetAutoClaimDrops(payload?: { readonly enabled?: boolean }) {
    await trackActivity('set-auto-claim-drops');
    await saveState(state, {
      updateAppState: (appState) => applyAutoClaimDropsSetting(appState, payload?.enabled),
    });
    return { success: true, autoClaimDrops: state.appState.autoClaimDrops };
  }

  async function handleSetStreamerSelectionMode(payload?: {
    readonly mode?: 'low-view' | 'random' | 'top-viewers';
  }) {
    await trackActivity('set-streamer-selection-mode');
    await saveState(state, {
      updateAppState: (appState) => applyStreamerSelectionModeSetting(appState, payload?.mode),
    });
    return { success: true, streamerSelectionMode: state.appState.streamerSelectionMode };
  }

  async function handleSetPreferredStreamerLanguage(payload?: { readonly language?: string | null }) {
    await trackActivity('set-preferred-streamer-language');
    await saveState(state, {
      updateAppState: (appState) => applyPreferredStreamerLanguageSetting(appState, payload?.language),
    });
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
    handleSetMonitorAutoOpen,
    handleSetMuteFarmingTab,
    handleSetTwitchAdblockEnabled: async (payload?: { readonly enabled?: boolean }) => {
      await trackActivity('set-setting');
      return twitchAdblock.setEnabled(payload?.enabled !== false);
    },
    handleTwitchAdsBlocked: (payload: { readonly count: number }, senderUrl?: string) =>
      twitchAdblock.recordBlockedAds(payload.count, senderUrl),
    handleSetNotificationsEnabled,
    handleSetPreferredStreamerLanguage,
    handleSetStreamerSelectionMode,
    handleSetTelegramAlertsEnabled: async (payload?: { readonly enabled?: boolean }) => {
      const revision = state.optionalPermissionRevisions.telegramAlertsEnabled;
      await trackActivity('set-telegram-alerts-enabled');
      const isCurrent = () => state.optionalPermissionRevisions.telegramAlertsEnabled === revision;
      if (!isCurrent()) return { success: false, error: 'Setting changed while permission was pending' };
      return dependencies.telegramNotifier.setTelegramAlertsEnabled(payload?.enabled !== false, isCurrent);
    },
    handleSetTelegramSystemAlertsEnabled: async (payload?: { readonly enabled?: boolean }) => {
      await trackActivity('set-telegram-system-alerts-enabled');
      await saveState(state, {
        updateAppState: (appState) => ({
          ...appState,
          telegramSystemAlertsEnabled: payload?.enabled !== false,
        }),
      });
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
