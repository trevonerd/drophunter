import { createBackupController } from './backup-controller.ts';
import { dismissFarmingMessage } from './dismiss-farming-message.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import type { createFarmingSession } from './farming-session.ts';
import { retryFarmingNow } from './manual-farming-retry.ts';
import { registerRuntimeMessageRouter } from './message-router.ts';
import { prepareOptionalPermissionConsent } from './optional-permission-consent.ts';
import { withRuntimeBackupGuard } from './runtime-backup-guard.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import type { createServiceWorkerContentHandlers } from './service-worker-content-handlers.ts';
import type { createServiceWorkerSettingsHandlers } from './service-worker-settings-handlers.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import { saveState } from './state-persistence.ts';

type BrowserEvents = ReturnType<typeof createServiceWorkerBrowserEvents>;
type ContentHandlers = ReturnType<typeof createServiceWorkerContentHandlers>;
type FarmingSession = ReturnType<typeof createFarmingSession>;
type SettingsHandlers = ReturnType<typeof createServiceWorkerSettingsHandlers>;
type StateLifecycle = ReturnType<typeof createServiceWorkerStateLifecycle>;

interface ServiceWorkerRuntimeDependencies {
  readonly automation: FarmingAutomation;
  readonly browserEvents: BrowserEvents;
  readonly contentHandlers: ContentHandlers;
  readonly farmingSession: FarmingSession;
  readonly settingsHandlers: SettingsHandlers;
  readonly stateLifecycle: StateLifecycle;
  readonly state: ServiceWorkerState;
}

type FarmingAutomationUserActionSession = Pick<
  FarmingSession,
  'handlePauseFarming' | 'handleResumeFarming' | 'handleStopFarming'
>;

async function runUserAction(
  automation: FarmingAutomation,
  action: () => Promise<{ readonly success: true }>,
) {
  automation.invalidate?.();
  return action();
}

export function createFarmingAutomationUserActionHandlers(
  automation: FarmingAutomation,
  farmingSession: FarmingAutomationUserActionSession,
) {
  return {
    pauseFarming: () => runUserAction(automation, farmingSession.handlePauseFarming),
    resumeFarming: () => runUserAction(automation, farmingSession.handleResumeFarming),
    stopFarming: () => runUserAction(automation, farmingSession.handleStopFarming),
  };
}

export function registerServiceWorkerRuntime(dependencies: ServiceWorkerRuntimeDependencies): void {
  const { browserEvents, contentHandlers, farmingSession, settingsHandlers, stateLifecycle } = dependencies;
  const userActions = createFarmingAutomationUserActionHandlers(dependencies.automation, farmingSession);
  const backup = createBackupController(dependencies.state, () => dependencies.automation.invalidate?.());
  registerRuntimeMessageRouter(
    {
      exportBackup: () => backup.exportBackup(),
      previewBackup: (message) => backup.previewBackup(message.payload.backup, message.payload.options),
      importBackup: (message) =>
        backup.importBackup(message.payload.backup, message.payload.options, message.payload.revision),
      activatePopup: async () => {
        const result = await contentHandlers.activatePopup();
        return {
          success: result.kind !== 'retry-scheduled',
          result,
          appState: contentHandlers.getAppState(),
          ...(result.kind === 'retry-scheduled' ? { error: result.error } : {}),
        };
      },
      openDropsAndSync: async () => {
        const result = await contentHandlers.openDropsAndSync();
        return {
          success: result.kind === 'synced' || result.kind === 'cache-fresh',
          result,
          appState: contentHandlers.getAppState(),
          ...(result.kind === 'needs-session'
            ? { error: 'Open Twitch Drops so DropHunter can detect your session.' }
            : result.kind === 'retry-scheduled'
              ? { error: result.error }
              : {}),
        };
      },
      ensureGamesCache: (message) => contentHandlers.ensureGamesCache(message.payload),
      openDropsPageAndRefresh: (message) => contentHandlers.openDropsPageAndRefresh(message),
      markDropsRefreshNoticeSeen: (message) => stateLifecycle.markDropsRefreshNoticeSeen(message.payload),
      addToQueue: (message) => farmingSession.handleAddToQueue(message.payload),
      removeFromQueue: (message) => farmingSession.handleRemoveFromQueue(message.payload),
      reorderQueue: (message) => farmingSession.handleReorderQueue(message.payload),
      clearQueue: farmingSession.handleClearQueue,
      startFarming: (message) => {
        dependencies.automation.invalidate?.();
        return farmingSession.handleStartFarming(message.payload);
      },
      startQueuedCampaign: (message) => {
        dependencies.automation.invalidate?.();
        return farmingSession.handleStartQueuedCampaign(message.payload.campaignKey);
      },
      setSelectedGame: (message) => farmingSession.handleSetSelectedGame(message.payload),
      pauseFarming: userActions.pauseFarming,
      resumeFarming: userActions.resumeFarming,
      retryFarming: () =>
        retryFarmingNow(dependencies.state, {
          checkDropProgress: farmingSession.checkDropProgress,
          acquireStreamerForSelectedGame: farmingSession.acquireStreamerForSelectedGame,
          saveState: () => saveState(dependencies.state),
        }),
      dismissFarmingMessage: (message) =>
        dismissFarmingMessage(dependencies.state, message.payload.id, () => saveState(dependencies.state)),
      stopFarming: userActions.stopFarming,
      updateGames: (message) => contentHandlers.handleUpdateGames(message.payload),
      syncTwitchSession: (message, sender) =>
        contentHandlers.handleSyncTwitchSession(message.payload, sender),
      syncTwitchIntegrity: (message, sender) =>
        contentHandlers.handleSyncTwitchIntegrity(message.payload, sender),
      refreshDrops: contentHandlers.refreshDrops,
      setMonitorAutoOpen: (message) => settingsHandlers.handleSetMonitorAutoOpen(message.payload),
      setMuteFarmingTab: (message) => settingsHandlers.handleSetMuteFarmingTab(message.payload),
      setTwitchAdblockEnabled: (message) => settingsHandlers.handleSetTwitchAdblockEnabled(message.payload),
      twitchAdsBlocked: (message, sender) =>
        settingsHandlers.handleTwitchAdsBlocked(message.payload, sender.url),
      setNotificationsEnabled: (message) => settingsHandlers.handleSetNotificationsEnabled(message.payload),
      setTelegramAlertsEnabled: (message) => settingsHandlers.handleSetTelegramAlertsEnabled(message.payload),
      setTelegramSystemAlertsEnabled: (message) =>
        settingsHandlers.handleSetTelegramSystemAlertsEnabled(message.payload),
      setTelegramCredentials: (message) => settingsHandlers.handleSetTelegramCredentials(message.payload),
      testTelegramAlerts: settingsHandlers.handleTestTelegramAlerts,
      getTelegramSettings: settingsHandlers.handleGetTelegramSettings,
      setAutoClaimChannelPointsBonus: (message) =>
        settingsHandlers.handleSetAutoClaimChannelPointsBonus(message.payload),
      channelPointsBonusClaimed: (message, sender) =>
        contentHandlers.handleChannelPointsBonusClaimed(message.payload, sender),
      setAutoClaimDrops: (message) => settingsHandlers.handleSetAutoClaimDrops(message.payload),
      setStreamerSelectionMode: (message) => settingsHandlers.handleSetStreamerSelectionMode(message.payload),
      setPreferredStreamerLanguage: (message) =>
        settingsHandlers.handleSetPreferredStreamerLanguage(message.payload),
      setGameFavorite: (message) => settingsHandlers.handleSetGameFavorite(message.payload),
      setGamePreference: (message) => settingsHandlers.handleSetGamePreference(message.payload),
      setCampaignPriorityMode: (message) => settingsHandlers.handleSetCampaignPriorityMode(message.payload),
      setFarmCategoryScope: (message) => settingsHandlers.handleSetFarmCategoryScope(message.payload),
      setAutoStartFavorites: (message) => settingsHandlers.handleSetAutoStartFavorites(message.payload),
      setWatchTransportMode: (message) => settingsHandlers.handleSetWatchTransportMode(message.payload),
      evaluateAutoStart: settingsHandlers.handleEvaluateAutoStart,
      openMonitorDashboard: (message) => browserEvents.openMonitorDashboardWindow(message.payload ?? {}),
      getClaimLog: settingsHandlers.handleGetClaimLog,
      clearClaimLog: settingsHandlers.handleClearClaimLog,
    },
    {
      aroundHandle: (handler, message) => withRuntimeBackupGuard(dependencies.state, handler, message),
      prepareHandle: (message, sender) =>
        prepareOptionalPermissionConsent(dependencies.state, message, sender),
      beforeHandle: async () => {
        await stateLifecycle.awaitInitialization();
        if (dependencies.state.backupImportInProgress)
          throw new Error('Backup restore is in progress. Try again shortly.');
      },
    },
  );
}

interface ServiceWorkerStarterDependencies {
  readonly beginInitialization: () => Promise<void>;
  readonly registerBrowserEvents: () => void;
  readonly registerRuntime: () => void;
  readonly reportInitializationError: (error: unknown) => void;
  readonly reportStarted: () => void;
}

export function createServiceWorkerStarter(dependencies: ServiceWorkerStarterDependencies): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    const initialization = dependencies.beginInitialization();
    void initialization.catch(dependencies.reportInitializationError);
    dependencies.registerBrowserEvents();
    dependencies.registerRuntime();
    dependencies.reportStarted();
  };
}
