import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationBrowser } from './farming-automation-browser.ts';
import type { FarmingAutomation, FarmingAutomationPersistence } from './farming-automation-contracts.ts';
import type { FarmingAutomationRecoveryResult } from './farming-automation-recovery.ts';
import { logWarn } from './logging.ts';

const FARMING_AUTOMATION_PERIOD_MINUTES = 2;
const MINIMUM_FARMING_AUTOMATION_WAKE_DELAY_MS = 30_000;

type ListenerEvent<TArgs extends unknown[]> = {
  addListener(handler: (...args: TArgs) => void): void;
};

export interface TabChangeInfo {
  readonly status?: string;
  readonly url?: string;
}

export interface ExtensionLifecycleApi {
  readonly runtime: {
    readonly onStartup: ListenerEvent<[]>;
    readonly onInstalled: ListenerEvent<[chrome.runtime.InstalledDetails]>;
  };
  readonly alarms: {
    readonly onAlarm: ListenerEvent<[chrome.alarms.Alarm]>;
  };
  readonly tabs: {
    readonly onRemoved: ListenerEvent<[number]>;
    readonly onUpdated: ListenerEvent<[number, TabChangeInfo]>;
  };
  readonly windows: {
    readonly onRemoved: ListenerEvent<[number]>;
  };
}

interface ExtensionLifecycleOptions {
  readonly api?: ExtensionLifecycleApi;
  readonly alarmName: string;
  readonly automationPeriodicAlarmName?: string;
  readonly automationDeadlineAlarmName?: string;
  readonly farmingAutomation: Pick<FarmingAutomation, 'request'>;
  readonly linkRecheckAlarmPrefix?: string;
  readonly getInitPromise: () => Promise<void> | null;
  readonly onExtensionUpdate: (details: chrome.runtime.InstalledDetails) => Promise<unknown> | unknown;
  readonly onAlarm: (alarm: chrome.alarms.Alarm) => Promise<unknown> | unknown;
  readonly onLinkRecheckAlarm?: (alarm: chrome.alarms.Alarm) => Promise<unknown> | unknown;
  readonly onManagedTabRemoved: (tabId: number) => Promise<unknown> | unknown;
  readonly onManagedTabNavigatedAway: (tabId: number, url: string) => Promise<unknown> | unknown;
  readonly onMonitorWindowRemoved: (windowId: number) => Promise<unknown> | unknown;
  readonly logWarn: (...args: unknown[]) => void;
}

interface FarmingAutomationLifecycleDependencies {
  readonly automation: Pick<FarmingAutomation, 'request'>;
  readonly browser: Pick<FarmingAutomationBrowser, 'replaceDeadlineAlarm' | 'schedulePeriodicAlarm'>;
  readonly persistence: Pick<FarmingAutomationPersistence, 'loadFacts'>;
  readonly recover: () => Promise<FarmingAutomationRecoveryResult>;
  readonly now?: () => number;
}

async function settleAutomationAlarm(operation: () => Promise<string>, label: string): Promise<void> {
  try {
    if ((await operation()) === 'failed') logWarn(label);
  } catch (error) {
    logWarn(label, { message: String(error) });
  }
}

export async function initializeFarmingAutomationLifecycle(
  dependencies: FarmingAutomationLifecycleDependencies,
): Promise<void> {
  const recovery = await dependencies.recover();
  if (recovery.kind === 'failed') throw new DOMException('Automation recovery failed', 'InvalidStateError');
  const facts = await dependencies.persistence.loadFacts();
  if (facts.kind === 'failed') throw new DOMException('Automation facts unavailable', 'InvalidStateError');
  await settleAutomationAlarm(
    () => dependencies.browser.schedulePeriodicAlarm(FARMING_AUTOMATION_PERIOD_MINUTES),
    'Farming automation periodic alarm creation failed',
  );
  const now = dependencies.now?.() ?? Date.now();
  const deadline = facts.value.nextEvaluationAt;
  if (deadline === null || deadline <= now) {
    await settleAutomationAlarm(
      () => dependencies.browser.replaceDeadlineAlarm(null),
      'Farming automation deadline clearing failed',
    );
    if (deadline !== null) await dependencies.automation.request('periodic');
    return;
  }
  await settleAutomationAlarm(
    () =>
      dependencies.browser.replaceDeadlineAlarm(
        Math.max(deadline, now + MINIMUM_FARMING_AUTOMATION_WAKE_DELAY_MS),
      ),
    'Farming automation deadline replacement failed',
  );
}

function isTwitchPageUrl(url: string): boolean {
  return /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(url);
}

function reportAsyncError(
  task: Promise<unknown> | unknown,
  label: string,
  logWarn: (...args: unknown[]) => void,
): void {
  Promise.resolve(task).catch((error) => logWarn(`${label}:`, String(error)));
}

async function awaitInitialization(getInitPromise: () => Promise<void> | null): Promise<void> {
  const initPromise = getInitPromise();
  if (initPromise) {
    await initPromise;
  }
}

export function registerExtensionLifecycleListeners(options: ExtensionLifecycleOptions): void {
  const api = options.api ?? browser;

  api.runtime.onStartup.addListener(() => {
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        await options.farmingAutomation.request('browser-start');
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
      (options.automationPeriodicAlarmName !== undefined &&
        alarm.name === options.automationPeriodicAlarmName) ||
      (options.automationDeadlineAlarmName !== undefined &&
        alarm.name === options.automationDeadlineAlarmName);
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
          await options.farmingAutomation.request('periodic');
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
    const url = changeInfo.url;
    if (!url || isTwitchPageUrl(url)) {
      return;
    }
    reportAsyncError(
      (async () => {
        await awaitInitialization(options.getInitPromise);
        await options.onManagedTabNavigatedAway(updatedTabId, url);
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
