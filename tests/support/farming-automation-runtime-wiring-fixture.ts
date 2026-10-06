import type { FarmingAutomation } from '../../src/background/farming-automation.ts';
import type { TwitchGame } from '../../src/types/index.ts';

export const game: TwitchGame = {
  id: 'game-1',
  campaignId: 'campaign-1',
  name: 'Game One',
  imageUrl: 'https://example.test/game.png',
  dropCount: 1,
};

const notStartedHealth = {
  mode: 'managed-tab' as const,
  isHealthy: false,
  status: 'not-started' as const,
  reason: 'not-started' as const,
  consecutiveFailures: 0,
  consecutiveStalls: 0,
  progress: null,
  shouldFallback: false,
  checkedAt: 0,
};

export function createSettingsDependencies(automation: FarmingAutomation) {
  return {
    automation,
    browserEvents: {
      watchTransport: {
        setPreference: async () => undefined,
        start: async () => ({ kind: 'failed' as const, health: notStartedHealth }),
        prepare: async () => ({ kind: 'failed' as const, reason: 'candidate-unavailable' as const }),
        currentTarget: () => null,
        stop: async () => undefined,
        restore: async () => false,
        currentOwnership: () => null,
        adopt: () => undefined,
        tick: async () => notStartedHealth,
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
    farmingSession: {
      resumeAfterAuthRecovery,
      stop: async () => undefined,
      acquireStreamerForSelectedGame: async () => false,
      advanceQueueIfCompleted: async () => false,
      handleAuthoritativeCampaignUnavailable: async () => undefined,
      handleStartFarming: async () => ({ success: true }),
    },
    notify: async () => undefined,
    clearQueueCompleteNotification: async () => undefined,
    stateLifecycle: {
      awaitInitialization: async () => undefined,
      ensureStateHydratedForCache: async () => undefined,
      getInitPromise: () => null,
      trackActivity: async () => undefined,
    },
    twitchGateway: {
      ensureContentScriptOnTab: async () => undefined,
      fetchDropsSnapshot: async () => null,
      fetchDropsSnapshotProgressively: async () => null,
      getLastTwitchApiFailure: () => null,
      persistSessionFromDropsPage: async () => null,
      shouldRefreshCampaignsAfterSessionSync: () => false,
    },
  };
}

export function disabledAutomation(): FarmingAutomation {
  return {
    request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
    suppressCampaignUntilRefresh: async () => 'suppressed',
  };
}
