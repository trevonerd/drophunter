import { browser } from '../shared/browser-api.ts';
import { observedStreamCategoryMatch } from '../shared/stream-category.ts';
import type { ActivationTrigger } from '../types/index.ts';
import { ALARM_NAME, CAMPAIGN_SYNC_RETRY_ALARM_NAME, INVALID_STREAM_THRESHOLD } from './constants.ts';
import { registerExtensionLifecycleListeners } from './extension-lifecycle.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import {
  FARMING_AUTOMATION_DEADLINE_ALARM,
  FARMING_AUTOMATION_PERIODIC_ALARM,
} from './farming-automation-browser.ts';
import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import { FARMING_RECOVERY_RETRY_ALARM_NAME } from './farming-recovery-alarm.ts';
import type { StreamContext } from './farming-session.ts';
import { logInfo, logWarn } from './logging.ts';
import { pauseManagedWatch } from './managed-watch-marker.ts';
import { openOwnedManagedWatch } from './managed-watch-open.ts';
import { openMonitorDashboardWindow as openMonitorDashboardWindowController } from './monitor-dashboard.ts';
import { createPlaybackOrchestrator } from './playback-orchestrator.ts';
import { createPlaybackTransport } from './playback-transport.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { broadcastStateUpdate, saveState } from './state-persistence.ts';
import {
  applyBestEffortAlwaysOnTop,
  clearManagedTabOwnership,
  ensureManagedTab,
  monitorDashboardUrl,
  shouldMuteManagedFarmingTab,
  streamerWatchUrl,
  waitForTabComplete,
} from './tab-management.ts';
import type { FarmingTarget, TablessHeartbeat } from './watch-transport.ts';
import { createWatchTransportCoordinator } from './watch-transport-coordinator.ts';

const LINK_RECHECK_ALARM_PREFIX = 'campaignLinkRecheck:';

interface ServiceWorkerBrowserDependencies {
  readonly ensureContentScriptOnTab: (tabId: number) => Promise<void>;
  readonly fetchStreamContext: (tabId: number) => Promise<StreamContext | null>;
  readonly heartbeat: (target: FarmingTarget) => Promise<TablessHeartbeat>;
  readonly notify: (title: string, message: string, priority?: number) => Promise<void>;
  readonly notifyQueueComplete: (title: string, message: string) => Promise<void>;
  readonly clearQueueCompleteNotification: () => Promise<void>;
}

interface ServiceWorkerBrowserRegistration {
  readonly getInitPromise: () => Promise<void> | null;
  readonly farmingAutomation: Pick<FarmingAutomation, 'request'>;
  readonly onExtensionUpdate: () => Promise<unknown>;
  readonly onExtensionStorageCleared: () => Promise<unknown>;
  readonly onMonitoringAlarm: () => Promise<unknown>;
  readonly onFarmingRecoveryAlarm: () => Promise<unknown>;
  readonly onActivationSync: (trigger: ActivationTrigger) => Promise<unknown>;
  readonly onLinkRecheckAlarm: () => Promise<unknown>;
}

export function createServiceWorkerBrowserEvents(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerBrowserDependencies,
) {
  const playbackTransport = createPlaybackTransport({
    ensureContentScriptOnTab: dependencies.ensureContentScriptOnTab,
    ensureManagedTab: (tabId, url, active, isCurrent) =>
      ensureManagedTab(
        tabId,
        url,
        active,
        state.appState.manualQueueAuthorized && state.appState.farmingSessionOrigin === 'manual',
        isCurrent,
      ),
    waitForTabComplete,
  });
  const playbackOrchestrator = createPlaybackOrchestrator(state, {
    transport: playbackTransport,
    shouldMuteManagedFarmingTab: () => shouldMuteManagedFarmingTab(state),
    streamerWatchUrl,
  });

  let watchTransport: ReturnType<typeof createWatchTransportCoordinator>;
  const ownedTabs = createChromeFarmingAutomationHost(() =>
    watchTransport.currentOwnership(),
  ).managedWatchOwnership;
  watchTransport = createWatchTransportCoordinator({
    state,
    enabled: true,
    heartbeat: dependencies.heartbeat,
    managedTab: {
      pause: async (session) => {
        if (session.ownership) await pauseManagedWatch(session.ownership);
      },
      pauseRetained: async (isCurrent) => {
        const ownership = await ownedTabs.reconstruct(
          null,
          () => ({
            running: false,
            activeChannel: null,
            tabId: null,
          }),
          isCurrent,
        );
        if (ownership && isCurrent()) await pauseManagedWatch(ownership, isCurrent);
      },
      finalizeOwnership: ownedTabs.finalize,
      open: (target, options) =>
        openOwnedManagedWatch(
          state,
          target,
          (tabId, isCurrent) =>
            playbackOrchestrator.prepareStreamPlayback(tabId, {
              unmuteTab: false,
              muteAfterPrep: true,
              isCurrent,
            }),
          () => watchTransport.currentOwnership(),
          options.isCurrent,
          ownedTabs,
          options.allowInitialCreation,
        ),
      probe: async (session, target) => {
        const context = await dependencies.fetchStreamContext(session.tabId);
        const sameChannel = context?.channelName.toLowerCase() === target.channelName.toLowerCase();
        const sameGame = observedStreamCategoryMatch(context, target);
        return {
          accepted: Boolean(context) && sameChannel && sameGame === true && context?.isPlaybackReady === true,
          isLive: context?.isLive,
          sameChannel,
          sameGame,
          hasDropsSignal: context?.hasDropsSignal,
          progress: state.appState.currentDrop?.currentMinutes ?? null,
          reason: !context
            ? 'heartbeat-failed'
            : !sameChannel
              ? 'wrong-channel'
              : sameGame === false
                ? 'wrong-game'
                : context.isPlaybackReady !== true
                  ? 'playback-inactive'
                  : sameGame === undefined
                    ? 'heartbeat-failed'
                    : 'heartbeat',
        };
      },
      close: async (session) => {
        const current = watchTransport.currentOwnership();
        const tabWasReused =
          session.ownership?.kind === 'managed-tab' &&
          current?.kind === 'managed-tab' &&
          current.tabId === session.tabId &&
          current.ownershipToken !== session.ownership.ownershipToken;
        if (session.ownership) {
          await ownedTabs.release(session.ownership);
        }
        if (!tabWasReused && state.appState.tabId === session.tabId) state.appState.tabId = null;
      },
    },
    persist: () => saveState(state),
    broadcast: () => broadcastStateUpdate(state.appState),
  });

  async function openMonitorDashboardWindow(options?: { readonly toggle?: boolean }) {
    return openMonitorDashboardWindowController(state, {
      ...options,
      monitorDashboardUrl,
      applyBestEffortAlwaysOnTop,
      saveState: () => saveState(state),
    });
  }

  async function sendAlert(kind: 'drop-complete' | 'all-complete', message: string): Promise<void> {
    if (kind === 'all-complete') {
      await dependencies.notifyQueueComplete('All drops completed', message);
    } else {
      await dependencies.notify('Drop completed', message);
    }
    const tabs = await browser.tabs.query({ url: ['https://www.twitch.tv/*', 'https://twitch.tv/*'] });
    await Promise.all(
      tabs.flatMap((tab) => {
        const tabId = tab.id;
        return typeof tabId === 'number'
          ? [
              browser.tabs
                .sendMessage(tabId, { type: 'PLAY_ALERT', payload: { kind, message } })
                .catch(() => undefined),
            ]
          : [];
      }),
    );
  }

  async function handleManagedTabRemoved(removedTabId: number): Promise<void> {
    if (state.appState.tabId !== removedTabId) return;
    clearManagedTabOwnership(state);
    await saveState(state);
  }

  async function handleManagedTabNavigatedAway(updatedTabId: number, url: string): Promise<void> {
    if (updatedTabId !== state.appState.tabId) return;
    logInfo('Managed tab navigated away from Twitch (onUpdated)', { url });
    clearManagedTabOwnership(state);
    state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
    await saveState(state);
  }

  async function handleMonitorWindowRemoved(removedWindowId: number): Promise<void> {
    if (state.appState.monitorWindowId !== removedWindowId) return;
    state.appState.monitorWindowId = null;
    await saveState(state);
  }

  function register(registration: ServiceWorkerBrowserRegistration): void {
    registerExtensionLifecycleListeners({
      alarmName: ALARM_NAME,
      campaignSyncAlarmName: 'campaignSync',
      campaignSyncRetryAlarmName: CAMPAIGN_SYNC_RETRY_ALARM_NAME,
      farmingRecoveryRetryAlarmName: FARMING_RECOVERY_RETRY_ALARM_NAME,
      automationPeriodicAlarmName: FARMING_AUTOMATION_PERIODIC_ALARM,
      automationDeadlineAlarmName: FARMING_AUTOMATION_DEADLINE_ALARM,
      farmingAutomation: registration.farmingAutomation,
      linkRecheckAlarmPrefix: LINK_RECHECK_ALARM_PREFIX,
      getInitPromise: registration.getInitPromise,
      onExtensionUpdate: registration.onExtensionUpdate,
      onExtensionStorageCleared: registration.onExtensionStorageCleared,
      onAlarm: registration.onMonitoringAlarm,
      onFarmingRecoveryAlarm: registration.onFarmingRecoveryAlarm,
      onActivationSync: registration.onActivationSync,
      onLinkRecheckAlarm: registration.onLinkRecheckAlarm,
      onManagedTabRemoved: handleManagedTabRemoved,
      onManagedTabNavigatedAway: handleManagedTabNavigatedAway,
      onManualTabChanged: registration.onMonitoringAlarm,
      onMonitorWindowRemoved: handleMonitorWindowRemoved,
      logWarn,
    });
  }

  return {
    attemptPlaybackSelfHeal: playbackOrchestrator.attemptPlaybackSelfHeal,
    clearQueueCompleteNotification: dependencies.clearQueueCompleteNotification,
    clearManagedTabOwnership: () => clearManagedTabOwnership(state),
    enforcePlaybackPolicyOnStreamTab: playbackOrchestrator.enforcePlaybackPolicyOnStreamTab,
    openForegroundChannel: playbackOrchestrator.openForegroundChannel,
    openMonitorDashboardWindow,
    prepareStreamPlayback: playbackOrchestrator.prepareStreamPlayback,
    register,
    sendAlert,
    watchTransport,
  };
}
