import { browser } from '../shared/browser-api.ts';
import { isExpectedStreamCategory } from '../shared/stream-category.ts';
import type { ActivationTrigger } from '../types/index.ts';
import { ALARM_NAME, CAMPAIGN_SYNC_RETRY_ALARM_NAME, INVALID_STREAM_THRESHOLD } from './constants.ts';
import { registerExtensionLifecycleListeners } from './extension-lifecycle.ts';
import type { FarmingAutomation } from './farming-automation.ts';
import {
  FARMING_AUTOMATION_DEADLINE_ALARM,
  FARMING_AUTOMATION_PERIODIC_ALARM,
} from './farming-automation-browser.ts';
import type { StreamContext } from './farming-session.ts';
import { logInfo, logWarn } from './logging.ts';
import { managedWatchMarker } from './managed-watch-marker.ts';
import { openOwnedManagedWatch } from './managed-watch-open.ts';
import { forgetClosedManagedWatch } from './managed-watch-registry.ts';
import { openMonitorDashboardWindow as openMonitorDashboardWindowController } from './monitor-dashboard.ts';
import { needsPlaybackAttention } from './playback.ts';
import { createPlaybackAttentionPolicy } from './playback-attention-policy.ts';
import { createPlaybackOrchestrator } from './playback-orchestrator.ts';
import { createPlaybackTransport } from './playback-transport.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { broadcastStateUpdate, saveState } from './state-persistence.ts';
import {
  applyBestEffortAlwaysOnTop,
  clearManagedTabOwnership,
  closeManagedTabIfSafe,
  ensureManagedTab,
  monitorDashboardUrl,
  releaseManagedTabOwnership,
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
  readonly onActivationSync: (trigger: ActivationTrigger) => Promise<unknown>;
  readonly onLinkRecheckAlarm: () => Promise<unknown>;
}

export function createServiceWorkerBrowserEvents(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerBrowserDependencies,
) {
  const playbackTransport = createPlaybackTransport({
    ensureContentScriptOnTab: dependencies.ensureContentScriptOnTab,
    ensureManagedTab,
    waitForTabComplete,
  });
  const playbackAttention = createPlaybackAttentionPolicy(state, {
    shouldMuteManagedFarmingTab: () => shouldMuteManagedFarmingTab(state),
    needsPlaybackAttention,
    notify: dependencies.notify,
  });
  const playbackOrchestrator = createPlaybackOrchestrator(state, {
    transport: playbackTransport,
    attention: playbackAttention,
    streamerWatchUrl,
  });

  const watchTransport = createWatchTransportCoordinator({
    state,
    enabled: true,
    heartbeat: dependencies.heartbeat,
    managedTab: {
      open: (target) =>
        openOwnedManagedWatch(state, target, async (tabId, isCurrent) => {
          playbackAttention.beginAttempt();
          const prepared = await playbackOrchestrator.prepareStreamPlayback(tabId, {
            unmuteTab: false,
            muteAfterPrep: true,
          });
          if (isCurrent()) await playbackAttention.notifyIfNeeded(prepared);
          return prepared;
        }),
      probe: async (session, target) => {
        const context = await dependencies.fetchStreamContext(session.tabId);
        const sameChannel = context?.channelName.toLowerCase() === target.channelName.toLowerCase();
        const sameGame = isExpectedStreamCategory(context, target);
        return {
          accepted: Boolean(context) && sameChannel && sameGame && context?.isPlaybackReady === true,
          isLive: context?.isLive,
          sameChannel,
          sameGame,
          hasDropsSignal: context?.hasDropsSignal,
          progress: state.appState.currentDrop?.currentMinutes ?? null,
          reason: !context
            ? 'heartbeat-failed'
            : !sameChannel
              ? 'wrong-channel'
              : !sameGame
                ? 'wrong-game'
                : context.isPlaybackReady !== true
                  ? 'playback-inactive'
                  : 'heartbeat',
        };
      },
      close: async (session) => {
        if (session.ownership) {
          await releaseManagedTabOwnership(session.ownership, {
            managedWatchMarker,
            tabs: {
              get: (tabId) => browser.tabs.get(tabId),
              query: (query) => browser.tabs.query(query),
              update: async (tabId, properties) => void (await browser.tabs.update(tabId, properties)),
              remove: async (tabId) => void (await browser.tabs.remove(tabId)),
            },
            sessionStorage: {
              get: (key) => browser.storage.session.get(key),
              remove: async (key) => void (await browser.storage.session.remove(key)),
            },
          });
        } else {
          await closeManagedTabIfSafe(session.tabId);
        }
        if (state.appState.tabId === session.tabId) state.appState.tabId = null;
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
    await forgetClosedManagedWatch(removedTabId);
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
      automationPeriodicAlarmName: FARMING_AUTOMATION_PERIODIC_ALARM,
      automationDeadlineAlarmName: FARMING_AUTOMATION_DEADLINE_ALARM,
      farmingAutomation: registration.farmingAutomation,
      linkRecheckAlarmPrefix: LINK_RECHECK_ALARM_PREFIX,
      getInitPromise: registration.getInitPromise,
      onExtensionUpdate: registration.onExtensionUpdate,
      onExtensionStorageCleared: registration.onExtensionStorageCleared,
      onAlarm: registration.onMonitoringAlarm,
      onActivationSync: registration.onActivationSync,
      onLinkRecheckAlarm: registration.onLinkRecheckAlarm,
      onManagedTabRemoved: handleManagedTabRemoved,
      onManagedTabNavigatedAway: handleManagedTabNavigatedAway,
      onMonitorWindowRemoved: handleMonitorWindowRemoved,
      logWarn,
    });
  }

  return {
    attemptPlaybackSelfHeal: playbackOrchestrator.attemptPlaybackSelfHeal,
    clearQueueCompleteNotification: dependencies.clearQueueCompleteNotification,
    clearManagedTabOwnership: () => clearManagedTabOwnership(state),
    closeManagedTabIfSafe,
    enforcePlaybackPolicyOnStreamTab: playbackOrchestrator.enforcePlaybackPolicyOnStreamTab,
    openForegroundChannel: playbackOrchestrator.openForegroundChannel,
    openMonitorDashboardWindow,
    prepareStreamPlayback: playbackOrchestrator.prepareStreamPlayback,
    register,
    sendAlert,
    watchTransport,
  };
}
