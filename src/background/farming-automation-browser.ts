import { browser } from '../shared/browser-api.ts';
import type { PlaybackPrepResult } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { type ManagedPlaybackPreparation, prepareManagedProvisionalWatch } from './managed-tab-transport.ts';
import type { ManualStreamContext } from './manual-watch-detector.ts';
import {
  type ManualPlaybackObservationResult,
  type ManualPlaybackTab,
  observeManualPlayback,
} from './playback-orchestrator.ts';
import { managedTabOwnershipKey, releaseManagedTabOwnership, streamerWatchUrl } from './tab-management.ts';
import { prepareTablessProvisionalWatch } from './tabless-transport.ts';
import type { FarmingTarget, TablessHeartbeat, WatchProbeResult } from './watch-transport.ts';
import {
  createWatchTransportTransition,
  type WatchReleaseResult,
  type WatchTransportRuntime,
  type WatchTransportTransition,
} from './watch-transport-transition.ts';

export const FARMING_AUTOMATION_DEADLINE_ALARM = 'favoriteCampaignDeadline';
export const FARMING_AUTOMATION_PERIODIC_ALARM = 'favoriteCampaignCheck';

export type FarmingAutomationTab = ManualPlaybackTab;

export interface FarmingAutomationChromeHost {
  readonly tabs: {
    create(properties: {
      readonly url: string;
      readonly active: false;
      readonly muted: true;
    }): Promise<FarmingAutomationTab | null>;
    get(tabId: number): Promise<FarmingAutomationTab | null>;
    query(query: {
      readonly windowId?: number;
      readonly active?: boolean;
    }): Promise<readonly FarmingAutomationTab[]>;
    update(
      tabId: number,
      properties: { readonly url?: string; readonly active?: boolean; readonly muted?: boolean },
    ): Promise<void>;
    remove(tabId: number): Promise<void>;
  };
  readonly sessionStorage: {
    get(key: string): Promise<Readonly<Record<string, unknown>>>;
    set(values: Readonly<Record<string, unknown>>): Promise<void>;
    remove(key: string): Promise<void>;
  };
  readonly permissions: { hasNotifications(): Promise<boolean> };
  readonly notifications: {
    create(id: string, options: chrome.notifications.NotificationCreateOptions): Promise<string>;
  };
  readonly alarms: {
    clear(name: string): Promise<boolean>;
    create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void> | void;
  };
  readonly runtime: { getUrl(path: string): string };
}

export interface FarmingAutomationWatchDependencies {
  readonly tablessEnabled: boolean;
  readonly heartbeat: (target: FarmingTarget) => Promise<TablessHeartbeat>;
  readonly waitForTabComplete: (tabId: number, timeoutMs: number) => Promise<void>;
  readonly preparePlayback: (
    tabId: number,
    options: ManagedPlaybackPreparation,
  ) => Promise<PlaybackPrepResult>;
  readonly probeManaged: (
    ownership: Extract<WatchOwnershipV1, { readonly kind: 'managed-tab' }>,
    target: FarmingTarget,
  ) => Promise<WatchProbeResult>;
  readonly now?: () => number;
}

export interface FarmingAutomationBrowserOptions {
  readonly host?: FarmingAutomationChromeHost;
  readonly watch: FarmingAutomationWatchDependencies;
  readonly getManualStreamContext: (tabId: number) => Promise<ManualStreamContext | null>;
  readonly currentOwnership?: WatchOwnershipV1 | null;
  readonly watchRuntime?: WatchTransportRuntime;
  readonly createOwnershipToken?: () => string;
}

export type FarmingAutomationNotification = {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly priority: number;
};

export type FarmingAutomationNotificationDelivery =
  | { readonly kind: 'delivered'; readonly notificationId: string }
  | { readonly kind: 'unavailable' };

export type FarmingAutomationManualTabsResult = ManualPlaybackObservationResult;

export interface FarmingAutomationBrowser {
  readonly watch: WatchTransportTransition;
  readonly hasNotificationPermission: () => Promise<boolean>;
  readonly deliverNotification: (
    notification: FarmingAutomationNotification,
  ) => Promise<FarmingAutomationNotificationDelivery>;
  readonly observeManualTabs: () => Promise<FarmingAutomationManualTabsResult>;
  readonly replaceDeadlineAlarm: (at: number | null) => Promise<'scheduled' | 'cleared' | 'failed'>;
  readonly schedulePeriodicAlarm: (periodInMinutes: number) => Promise<'scheduled' | 'failed'>;
}

class ProvisionalPlaybackNotReadyError extends Error {
  readonly name = 'ProvisionalPlaybackNotReadyError';

  constructor() {
    super('Provisional managed playback is not ready');
  }
}

async function attempt<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export function createChromeFarmingAutomationHost(): FarmingAutomationChromeHost {
  return {
    tabs: {
      create: (properties) => browser.tabs.create(properties),
      get: (tabId) => browser.tabs.get(tabId),
      query: (query) => browser.tabs.query(query),
      update: async (tabId, properties) => void (await browser.tabs.update(tabId, properties)),
      remove: async (tabId) => void (await browser.tabs.remove(tabId)),
    },
    sessionStorage: {
      get: (key) => browser.storage.session.get(key),
      set: async (values) => void (await browser.storage.session.set(values)),
      remove: async (key) => void (await browser.storage.session.remove(key)),
    },
    permissions: {
      hasNotifications: () => browser.permissions.contains({ permissions: ['notifications'] }),
    },
    notifications: { create: (id, notification) => browser.notifications.create(id, notification) },
    alarms: {
      clear: (name) => browser.alarms.clear(name),
      create: async (name, info) => void (await browser.alarms.create(name, info)),
    },
    runtime: { getUrl: (path) => new URL(path, browser.runtime.getURL('/popup.html')).toString() },
  };
}

export function createFarmingAutomationBrowser(
  options: FarmingAutomationBrowserOptions,
): FarmingAutomationBrowser {
  const host = options.host ?? createChromeFarmingAutomationHost();
  const now = options.watch.now ?? Date.now;

  const release = async (ownership: WatchOwnershipV1): Promise<WatchReleaseResult> => {
    if (ownership.kind === 'tabless') return { kind: 'not-required' };
    return releaseManagedTabOwnership(ownership, host);
  };

  const prepareManaged = (target: FarmingTarget) =>
    prepareManagedProvisionalWatch(target, streamerWatchUrl(target.channelName), {
      createOwnershipToken: options.createOwnershipToken ?? (() => globalThis.crypto.randomUUID()),
      persistOwnership: async (token, expectedUrl) =>
        Boolean(
          await attempt(async () => {
            const key = managedTabOwnershipKey(token);
            await host.sessionStorage.set({ [key]: { version: 1, expectedUrl } });
            return true;
          }),
        ),
      discardOwnership: async (token) => {
        await attempt(async () => {
          await host.sessionStorage.remove(managedTabOwnershipKey(token));
          return true;
        });
      },
      openTab: async (expectedUrl) =>
        attempt(() => host.tabs.create({ url: expectedUrl, active: false, muted: true })),
      waitForTabComplete: options.watch.waitForTabComplete,
      preparePlayback: async (tabId, preparationOptions) => {
        const preparation = await options.watch.preparePlayback(tabId, preparationOptions);
        if (preparation.isPlaybackReady !== true) throw new ProvisionalPlaybackNotReadyError();
        return preparation;
      },
      probe: options.watch.probeManaged,
      release,
      now,
    });

  const prepareTabless = (target: FarmingTarget) =>
    prepareTablessProvisionalWatch(target, {
      enabled: options.watch.tablessEnabled,
      heartbeat: options.watch.heartbeat,
      now,
    });

  const watch = createWatchTransportTransition({
    currentOwnership: options.currentOwnership ?? null,
    runtime: options.watchRuntime,
    prepareManaged,
    prepareTabless,
    release,
  });
  const replaceDeadlineAlarm = async (at: number | null): Promise<'scheduled' | 'cleared' | 'failed'> => {
    const cleared = await attempt(async () => {
      await host.alarms.clear(FARMING_AUTOMATION_DEADLINE_ALARM);
      return true;
    });
    if (!cleared) return 'failed';
    if (at === null) return 'cleared';
    const scheduled = await attempt(async () => {
      await host.alarms.create(FARMING_AUTOMATION_DEADLINE_ALARM, { when: at });
      return true;
    });
    return scheduled ? 'scheduled' : 'failed';
  };
  const schedulePeriodicAlarm = async (periodInMinutes: number): Promise<'scheduled' | 'failed'> => {
    const scheduled = await attempt(async () => {
      await host.alarms.create(FARMING_AUTOMATION_PERIODIC_ALARM, {
        periodInMinutes: Math.max(0.5, periodInMinutes),
      });
      return true;
    });
    return scheduled ? 'scheduled' : 'failed';
  };
  const hasNotificationPermission = async (): Promise<boolean> =>
    (await attempt(() => host.permissions.hasNotifications())) ?? false;
  const deliverNotification = async (
    notification: FarmingAutomationNotification,
  ): Promise<FarmingAutomationNotificationDelivery> => {
    const notificationId = await attempt(() =>
      host.notifications.create(notification.id, {
        type: 'basic',
        iconUrl: host.runtime.getUrl('icons/icon128.png'),
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
      }),
    );
    return notificationId ? { kind: 'delivered', notificationId } : { kind: 'unavailable' };
  };
  const observeManualTabs = () => observeManualPlayback(host.tabs, options.getManualStreamContext);
  return {
    watch,
    replaceDeadlineAlarm,
    schedulePeriodicAlarm,
    hasNotificationPermission,
    deliverNotification,
    observeManualTabs,
  };
}
