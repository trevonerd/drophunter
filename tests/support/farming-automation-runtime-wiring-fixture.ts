import type { FarmingAutomation } from '../../src/background/farming-automation.ts';
import type { TwitchGame } from '../../src/types/index.ts';

export const game: TwitchGame = {
  id: 'game-1',
  campaignId: 'campaign-1',
  name: 'Game One',
  imageUrl: 'https://example.test/game.png',
  dropCount: 1,
};

export function createSettingsDependencies(automation: FarmingAutomation) {
  return {
    automation,
    browserEvents: {
      watchTransport: {
        setPreference: async () => undefined,
        start: async () => ({ kind: 'started' as const }),
        stop: async () => undefined,
      },
    },
    notificationController: {
      setNotificationsEnabled: async () => ({ success: true, notificationsEnabled: true }),
    },
    stateLifecycle: {
      awaitInitialization: async () => undefined,
      trackActivity: async () => undefined,
    },
    telegramNotifier: {
      sendTestAlert: async () => ({ success: true }),
      setTelegramAlertsEnabled: async () => ({ success: true, telegramAlertsEnabled: true }),
      setTelegramCredentials: async () => ({ success: true, configured: true, chatId: '1' }),
    },
  };
}

export function createContentDependencies(
  automation: FarmingAutomation,
  resumeAfterAuthRecovery: () => Promise<void> = async () => undefined,
) {
  return {
    automation,
    farmingSession: { resumeAfterAuthRecovery, stop: async () => undefined },
    notify: async () => undefined,
    stateLifecycle: {
      awaitInitialization: async () => undefined,
      ensureStateHydratedForCache: async () => undefined,
      getInitPromise: () => null,
      trackActivity: async () => undefined,
    },
    twitchGateway: {
      ensureContentScriptOnTab: async () => undefined,
      fetchDropsSnapshot: async () => null,
      persistSessionFromDropsPage: async () => null,
      shouldRefreshCampaignsAfterSessionSync: () => false,
    },
  };
}

export function disabledAutomation(): FarmingAutomation {
  return {
    request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
    snooze: async () => 'snoozed',
  };
}
