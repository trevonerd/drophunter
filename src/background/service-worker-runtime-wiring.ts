import type { FarmingAutomation } from './farming-automation.ts';
import type { createFarmingSession } from './farming-session.ts';
import { registerRuntimeMessageRouter } from './message-router.ts';
import type { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import type { createServiceWorkerContentHandlers } from './service-worker-content-handlers.ts';
import type { createServiceWorkerSettingsHandlers } from './service-worker-settings-handlers.ts';
import type { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';

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
}

type FarmingAutomationUserActionSession = Pick<
  FarmingSession,
  'handlePauseFarming' | 'handleResumeFarming' | 'handleStopFarming'
>;

async function runSnoozedUserAction(
  automation: FarmingAutomation,
  reason: 'manual-pause' | 'manual-stop',
  action: () => Promise<{ readonly success: true }>,
  persistenceError: string,
) {
  const snooze = await automation.snooze(reason);
  const result = await action();
  return snooze === 'snoozed' ? result : { success: false, error: persistenceError };
}

export function createFarmingAutomationUserActionHandlers(
  automation: FarmingAutomation,
  farmingSession: FarmingAutomationUserActionSession,
) {
  return {
    pauseFarming: () =>
      runSnoozedUserAction(
        automation,
        'manual-pause',
        farmingSession.handlePauseFarming,
        'Farming paused, but the automatic-farming snooze could not be persisted.',
      ),
    resumeFarming: farmingSession.handleResumeFarming,
    stopFarming: () =>
      runSnoozedUserAction(
        automation,
        'manual-stop',
        farmingSession.handleStopFarming,
        'Farming stopped, but the automatic-farming snooze could not be persisted.',
      ),
  };
}

export function registerServiceWorkerRuntime(dependencies: ServiceWorkerRuntimeDependencies): void {
  const { browserEvents, contentHandlers, farmingSession, settingsHandlers, stateLifecycle } = dependencies;
  const userActions = createFarmingAutomationUserActionHandlers(dependencies.automation, farmingSession);
  registerRuntimeMessageRouter(
    {
      ensureGamesCache: (message) => contentHandlers.ensureGamesCache(message.payload),
      openDropsPageAndRefresh: (message) => contentHandlers.openDropsPageAndRefresh(message),
      markDropsRefreshNoticeSeen: (message) => stateLifecycle.markDropsRefreshNoticeSeen(message.payload),
      addToQueue: (message) => farmingSession.handleAddToQueue(message.payload),
      removeFromQueue: (message) => farmingSession.handleRemoveFromQueue(message.payload),
      reorderQueue: (message) => farmingSession.handleReorderQueue(message.payload),
      clearQueue: farmingSession.handleClearQueue,
      startFarming: (message) => farmingSession.handleStartFarming(message.payload),
      setSelectedGame: (message) => farmingSession.handleSetSelectedGame(message.payload),
      pauseFarming: userActions.pauseFarming,
      setAutoResumeOnStartup: (message) => settingsHandlers.handleSetAutoResumeOnStartup(message.payload),
      resumeFarming: userActions.resumeFarming,
      stopFarming: userActions.stopFarming,
      updateGames: (message) => contentHandlers.handleUpdateGames(message.payload),
      syncTwitchSession: (message, sender) =>
        contentHandlers.handleSyncTwitchSession(message.payload, sender),
      syncTwitchIntegrity: (message, sender) =>
        contentHandlers.handleSyncTwitchIntegrity(message.payload, sender),
      refreshDrops: farmingSession.handleRefreshDrops,
      setMonitorAutoOpen: (message) => settingsHandlers.handleSetMonitorAutoOpen(message.payload),
      setMuteFarmingTab: (message) => settingsHandlers.handleSetMuteFarmingTab(message.payload),
      setNotificationsEnabled: (message) => settingsHandlers.handleSetNotificationsEnabled(message.payload),
      setTelegramAlertsEnabled: (message) => settingsHandlers.handleSetTelegramAlertsEnabled(message.payload),
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
      setCampaignPriorityMode: (message) => settingsHandlers.handleSetCampaignPriorityMode(message.payload),
      setFarmCategoryScope: (message) => settingsHandlers.handleSetFarmCategoryScope(message.payload),
      setAutoStartFavorites: (message) => settingsHandlers.handleSetAutoStartFavorites(message.payload),
      setWatchTransportMode: (message) => settingsHandlers.handleSetWatchTransportMode(message.payload),
      evaluateAutoStart: settingsHandlers.handleEvaluateAutoStart,
      openMonitorDashboard: (message) => browserEvents.openMonitorDashboardWindow(message.payload ?? {}),
      getClaimLog: settingsHandlers.handleGetClaimLog,
      clearClaimLog: settingsHandlers.handleClearClaimLog,
    },
    { beforeHandle: stateLifecycle.awaitInitialization },
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
