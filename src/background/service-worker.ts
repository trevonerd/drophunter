import { automationNotificationPersistence } from './automation-notification-persistence.ts';
import { setClaimRecordedHandler } from './claim-log.ts';
import { createFarmingSession } from './farming-session.ts';
import { logDebug, logWarn } from './logging.ts';
import { createNotificationController } from './notifications.ts';
import { createServiceWorkerState } from './runtime-state.ts';
import { createServiceWorkerBrowserEvents } from './service-worker-browser-events.ts';
import { createServiceWorkerContentHandlers } from './service-worker-content-handlers.ts';
import {
  createServiceWorkerFarmingAutomationRuntime,
  type ServiceWorkerFarmingAutomationRuntime,
} from './service-worker-farming-automation.ts';
import { createServiceWorkerStarter, registerServiceWorkerRuntime } from './service-worker-runtime-wiring.ts';
import { createServiceWorkerSettingsHandlers } from './service-worker-settings-handlers.ts';
import { createServiceWorkerStateLifecycle } from './service-worker-state-lifecycle.ts';
import { createServiceWorkerTwitchGateway } from './service-worker-twitch-gateway.ts';
import { broadcastStateUpdate, saveState, saveTimingState } from './state-persistence.ts';
import './stream-rotation.ts';
import {
  createTelegramNotifier,
  loadTelegramCredentials,
  saveTelegramCredentials,
} from './telegram-notifications.ts';

export type { RefreshDropsOptions, StreamContext } from './farming-session.ts';
export type { ServiceWorkerState } from './runtime-state.ts';

export const MONITOR_AUTO_OPEN_DELAY_MS = 450;
export const TWITCH_SESSION_STORAGE_KEY = 'twitchSession';
export const DROPS_SNAPSHOT_CACHE_KEY = 'dropsSnapshotCache';
export const TIMING_STATE_KEY = 'timingState';
export const LAST_ACTIVITY_AT_KEY = 'lastActivityAt';
export const ALARM_NAME = 'dropCheck';
export const INACTIVITY_RESET_MS = 3 * 24 * 60 * 60_000;
export const STREAM_CONTEXT_TIMEOUT_MS = 12_000;
export const LINK_RECHECK_ALARM_PREFIX = 'campaignLinkRecheck:';
export const GAMES_CACHE_TTL_MS = 5 * 60_000;

const state = createServiceWorkerState();
let farmingSession: ReturnType<typeof createFarmingSession>;
let farmingAutomationRuntime: ServiceWorkerFarmingAutomationRuntime;
let contentHandlers: ReturnType<typeof createServiceWorkerContentHandlers>;
let browserEvents: ReturnType<typeof createServiceWorkerBrowserEvents>;

const notificationController = createNotificationController(state, {
  saveState: () => saveState(state),
  automationNotificationPersistence,
  openDropHunter: () => browserEvents.openMonitorDashboardWindow({ toggle: false }),
  pauseFarming: async () => {
    await farmingAutomationRuntime.automation.snooze('manual-pause');
    await farmingSession.handlePauseFarming();
  },
});

const telegramNotifier = createTelegramNotifier(state, {
  saveState: () => saveState(state),
  loadCredentials: loadTelegramCredentials,
  saveCredentials: saveTelegramCredentials,
});

setClaimRecordedHandler((entries) => telegramNotifier.notifyClaimedDrops(entries));

const twitchGateway = createServiceWorkerTwitchGateway(state, {
  recoverTwitchSession: (options) =>
    farmingSession.recoverTwitchSession({ notification: options.notification }),
});

const notify = (title: string, message: string, priority = 2) =>
  notificationController.notify(title, message, priority);

browserEvents = createServiceWorkerBrowserEvents(state, {
  ensureContentScriptOnTab: twitchGateway.ensureContentScriptOnTab,
  fetchStreamContext: twitchGateway.fetchStreamContext,
  heartbeat: twitchGateway.heartbeat,
  notify,
});

farmingAutomationRuntime = createServiceWorkerFarmingAutomationRuntime(state, {
  browserEvents,
  startMonitoring: () => farmingSession.startMonitoring(),
  twitchGateway,
});

const stateLifecycle = createServiceWorkerStateLifecycle(state, {
  getFarmingSession: () => farmingSession,
  initializeFarmingAutomation: farmingAutomationRuntime.initialize,
});

farmingSession = createFarmingSession(state, {
  getInitPromise: stateLifecycle.getInitPromise,
  trackActivity: stateLifecycle.trackActivity,
  ensureTwitchSession: twitchGateway.ensureTwitchSession,
  fetchDropsSnapshotFromApi: twitchGateway.fetchDropsSnapshot,
  fetchInventorySnapshotFromApi: twitchGateway.fetchInventorySnapshot,
  fetchDirectoryStreamersFromApi: twitchGateway.fetchDirectoryStreamers,
  fetchStreamContext: twitchGateway.fetchStreamContext,
  resolveCategorySlug: async (game) => twitchGateway.resolveCategorySlug(game),
  openForegroundChannel: async (streamer) => {
    await browserEvents.openForegroundChannel(streamer);
  },
  enforcePlaybackPolicyOnStreamTab: browserEvents.enforcePlaybackPolicyOnStreamTab,
  attemptPlaybackSelfHeal: browserEvents.attemptPlaybackSelfHeal,
  attemptAutoClaimChannelPointsBonus: () => contentHandlers.attemptAutoClaimChannelPointsBonus(),
  closeManagedTabIfSafe: browserEvents.closeManagedTabIfSafe,
  clearManagedTabOwnership: browserEvents.clearManagedTabOwnership,
  openMonitorDashboardWindow: browserEvents.openMonitorDashboardWindow,
  sendAlert: browserEvents.sendAlert,
  notify,
  saveState,
  saveTimingState,
  broadcastStateUpdate,
  monitorAutoOpenDelayMs: MONITOR_AUTO_OPEN_DELAY_MS,
  manualWatchController: farmingAutomationRuntime.manualWatch,
  watchTransport: browserEvents.watchTransport,
});

contentHandlers = createServiceWorkerContentHandlers(state, {
  automation: farmingAutomationRuntime.automation,
  farmingSession,
  stateLifecycle,
  twitchGateway,
  notify,
});

const settingsHandlers = createServiceWorkerSettingsHandlers(state, {
  automation: farmingAutomationRuntime.automation,
  browserEvents,
  notificationController,
  stateLifecycle,
  telegramNotifier,
});

const startServiceWorkerOnce = createServiceWorkerStarter({
  beginInitialization: () =>
    stateLifecycle.beginInitialization(async () => {
      await notificationController.syncPermissionState();
      await telegramNotifier.syncPermissionState();
    }),
  registerBrowserEvents: () =>
    browserEvents.register({
      getInitPromise: stateLifecycle.getInitPromise,
      farmingAutomation: farmingAutomationRuntime.automation,
      onExtensionUpdate: stateLifecycle.handleExtensionUpdate,
      onMonitoringAlarm: farmingSession.checkDropProgress,
      onLinkRecheckAlarm: farmingSession.handleRefreshDrops,
    }),
  registerRuntime: () =>
    registerServiceWorkerRuntime({
      automation: farmingAutomationRuntime.automation,
      browserEvents,
      contentHandlers,
      farmingSession,
      settingsHandlers,
      stateLifecycle,
    }),
  reportInitializationError: (error) => logWarn('SW initialization failed:', String(error)),
  reportStarted: () => logDebug('DropHunter service worker loaded'),
});

export function startServiceWorker(): void {
  startServiceWorkerOnce();
}
