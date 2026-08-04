import { browser } from '../shared/browser-api.ts';

type ListenerEvent<TArgs extends unknown[]> = {
  addListener(handler: (...args: TArgs) => void): void;
};

export interface TabChangeInfo {
  status?: string;
  url?: string;
}

export interface ExtensionLifecycleApi {
  runtime: {
    onStartup: ListenerEvent<[]>;
    onInstalled: ListenerEvent<[chrome.runtime.InstalledDetails]>;
  };
  alarms: {
    onAlarm: ListenerEvent<[chrome.alarms.Alarm]>;
  };
  tabs: {
    onRemoved: ListenerEvent<[number]>;
    onUpdated: ListenerEvent<[number, TabChangeInfo]>;
  };
  windows: {
    onRemoved: ListenerEvent<[number]>;
  };
}

interface ExtensionLifecycleOptions {
  api?: ExtensionLifecycleApi;
  alarmName: string;
  automationAlarmName?: string;
  linkRecheckAlarmPrefix?: string;
  getInitPromise: () => Promise<void> | null;
  onExtensionUpdate: (details: chrome.runtime.InstalledDetails) => Promise<unknown> | unknown;
  onBrowserStartup?: () => Promise<unknown> | unknown;
  onAlarm: (alarm: chrome.alarms.Alarm) => Promise<unknown> | unknown;
  onAutomationAlarm?: (alarm: chrome.alarms.Alarm) => Promise<unknown> | unknown;
  onLinkRecheckAlarm?: (alarm: chrome.alarms.Alarm) => Promise<unknown> | unknown;
  onManagedTabRemoved: (tabId: number) => Promise<unknown> | unknown;
  onManagedTabNavigatedAway: (tabId: number, url: string) => Promise<unknown> | unknown;
  onMonitorWindowRemoved: (windowId: number) => Promise<unknown> | unknown;
  logWarn: (...args: unknown[]) => void;
}

function isTwitchPageUrl(url: string): boolean {
  return /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(url);
}

function reportAsyncError(
  task: Promise<unknown> | unknown,
  label: string,
  logWarn: (...args: unknown[]) => void,
) {
  Promise.resolve(task).catch((error) => logWarn(`${label}:`, String(error)));
}

async function awaitInitialization(getInitPromise: () => Promise<void> | null) {
  const initPromise = getInitPromise();
  if (initPromise) {
    await initPromise;
  }
}

export function registerExtensionLifecycleListeners(options: ExtensionLifecycleOptions) {
  const api = options.api ?? browser;

  api.runtime.onStartup.addListener(() => {
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        await options.onBrowserStartup?.();
      })(),
      'onStartup error',
      options.logWarn,
    );
  });

  api.runtime.onInstalled.addListener((details) => {
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        if (details.reason === 'update') {
          await options.onExtensionUpdate(details);
        }
      })(),
      'onInstalled error',
      options.logWarn,
    );
  });

  api.alarms.onAlarm.addListener((alarm) => {
    const isMonitoringAlarm = alarm.name === options.alarmName;
    const isAutomationAlarm =
      options.automationAlarmName !== undefined && alarm.name === options.automationAlarmName;
    const isLinkRecheckAlarm =
      options.linkRecheckAlarmPrefix !== undefined && alarm.name.startsWith(options.linkRecheckAlarmPrefix);
    if (!isMonitoringAlarm && !isAutomationAlarm && !isLinkRecheckAlarm) {
      return;
    }
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        if (isMonitoringAlarm) {
          await options.onAlarm(alarm);
        } else if (isAutomationAlarm) {
          await options.onAutomationAlarm?.(alarm);
        } else {
          await options.onLinkRecheckAlarm?.(alarm);
        }
      })(),
      'Monitoring error',
      options.logWarn,
    );
  });

  api.tabs.onRemoved.addListener((removedTabId) => {
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        await options.onManagedTabRemoved(removedTabId);
      })(),
      'tabs.onRemoved error',
      options.logWarn,
    );
  });

  api.tabs.onUpdated.addListener((updatedTabId, changeInfo) => {
    if (!changeInfo.url || isTwitchPageUrl(changeInfo.url)) {
      return;
    }
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        await options.onManagedTabNavigatedAway(updatedTabId, changeInfo.url as string);
      })(),
      'tabs.onUpdated error',
      options.logWarn,
    );
  });

  api.windows.onRemoved.addListener((removedWindowId) => {
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        await options.onMonitorWindowRemoved(removedWindowId);
      })(),
      'windows.onRemoved error',
      options.logWarn,
    );
  });
}
