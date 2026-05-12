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
  getInitPromise: () => Promise<void> | null;
  onExtensionUpdate: (details: chrome.runtime.InstalledDetails) => Promise<unknown> | unknown;
  onAlarm: (alarm: chrome.alarms.Alarm) => Promise<unknown> | unknown;
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
  const api = options.api ?? chrome;

  api.runtime.onStartup.addListener(() => {
    reportAsyncError(awaitInitialization(options.getInitPromise), 'onStartup error', options.logWarn);
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
    if (alarm.name !== options.alarmName) {
      return;
    }
    reportAsyncError(options.onAlarm(alarm), 'Monitoring error', options.logWarn);
  });

  api.tabs.onRemoved.addListener((removedTabId) => {
    reportAsyncError(options.onManagedTabRemoved(removedTabId), 'tabs.onRemoved error', options.logWarn);
  });

  api.tabs.onUpdated.addListener((updatedTabId, changeInfo) => {
    if (!changeInfo.url || isTwitchPageUrl(changeInfo.url)) {
      return;
    }
    reportAsyncError(
      options.onManagedTabNavigatedAway(updatedTabId, changeInfo.url),
      'tabs.onUpdated error',
      options.logWarn,
    );
  });

  api.windows.onRemoved.addListener((removedWindowId) => {
    reportAsyncError(
      options.onMonitorWindowRemoved(removedWindowId),
      'windows.onRemoved error',
      options.logWarn,
    );
  });
}
