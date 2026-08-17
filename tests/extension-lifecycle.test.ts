import { describe, expect, test } from 'bun:test';
import {
  registerExtensionLifecycleListeners,
  type TabChangeInfo,
} from '../src/background/extension-lifecycle.ts';

function createEvent<TArgs extends unknown[]>() {
  const handlers: Array<(...args: TArgs) => void> = [];
  return {
    addListener(handler: (...args: TArgs) => void) {
      handlers.push(handler);
    },
    trigger(...args: TArgs) {
      for (const handler of handlers) {
        handler(...args);
      }
    },
    handlers,
  };
}

function createLifecycleApi() {
  return {
    runtime: {
      onStartup: createEvent<[]>(),
      onInstalled: createEvent<[chrome.runtime.InstalledDetails]>(),
    },
    alarms: {
      onAlarm: createEvent<[chrome.alarms.Alarm]>(),
    },
    tabs: {
      onRemoved: createEvent<[number]>(),
      onUpdated: createEvent<[number, TabChangeInfo]>(),
    },
    windows: {
      onRemoved: createEvent<[number]>(),
    },
  };
}

async function flushAsyncListeners() {
  await Promise.resolve();
  await Promise.resolve();
}

const inactiveAutomation = {
  async request() {
    return { kind: 'unchanged', reason: 'disabled' } as const;
  },
};

describe('extension lifecycle listeners', () => {
  test('waits for initialization before handling alarms and tab or window changes', async () => {
    const api = createLifecycleApi();
    const calls: string[] = [];
    let releaseInitialization: () => void = () => undefined;
    const initialization = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingAutomation: inactiveAutomation,
      getInitPromise: () => initialization,
      onExtensionUpdate: async () => {},
      onAlarm: async () => {
        calls.push('alarm');
      },
      onManagedTabRemoved: async () => {
        calls.push('tab-removed');
      },
      onManagedTabNavigatedAway: async () => {
        calls.push('tab-updated');
      },
      onMonitorWindowRemoved: async () => {
        calls.push('window-removed');
      },
      logWarn: () => {},
    });

    api.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: 1 });
    api.tabs.onRemoved.trigger(10);
    api.tabs.onUpdated.trigger(10, { url: 'https://example.com/' });
    api.windows.onRemoved.trigger(20);
    await flushAsyncListeners();

    expect(calls).toEqual([]);
    releaseInitialization();
    await flushAsyncListeners();
    expect(calls).toEqual(['alarm', 'tab-removed', 'tab-updated', 'window-removed']);
  });

  test('awaits initialization before handling an extension update', async () => {
    const api = createLifecycleApi();
    const calls: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingAutomation: inactiveAutomation,
      getInitPromise: () =>
        Promise.resolve().then(() => {
          calls.push('init');
        }),
      onExtensionUpdate: async () => {
        calls.push('update');
      },
      onAlarm: async () => {},
      onManagedTabRemoved: async () => {},
      onManagedTabNavigatedAway: async () => {},
      onMonitorWindowRemoved: async () => {},
      logWarn: () => {},
    });

    api.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '2.0.0' });
    await flushAsyncListeners();

    expect(calls).toEqual(['init', 'update']);
  });

  test('runs browser startup and automation alarms only after initialization', async () => {
    const api = createLifecycleApi();
    const calls: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      automationPeriodicAlarmName: 'favoriteCampaignCheck',
      farmingAutomation: {
        async request(trigger) {
          calls.push(trigger === 'browser-start' ? 'startup' : 'automation');
          return { kind: 'unchanged', reason: 'disabled' } as const;
        },
      },
      getInitPromise: () => Promise.resolve().then(() => calls.push('init')),
      onExtensionUpdate: async () => {},
      onAlarm: async () => {},
      onManagedTabRemoved: async () => {},
      onManagedTabNavigatedAway: async () => {},
      onMonitorWindowRemoved: async () => {},
      logWarn: () => {},
    });

    api.runtime.onStartup.trigger();
    api.alarms.onAlarm.trigger({ name: 'favoriteCampaignCheck', scheduledTime: 1 });
    await flushAsyncListeners();

    expect(calls).toEqual(['init', 'init', 'startup', 'automation']);
  });

  test('does not invoke lifecycle handlers when initialization fails', async () => {
    const api = createLifecycleApi();
    const calls: string[] = [];
    const warnings: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingAutomation: inactiveAutomation,
      getInitPromise: () => Promise.reject(new Error('storage migration failed')),
      onExtensionUpdate: async () => {
        calls.push('update');
      },
      onAlarm: async () => {
        calls.push('alarm');
      },
      onManagedTabRemoved: async () => {
        calls.push('tab-removed');
      },
      onManagedTabNavigatedAway: async () => {
        calls.push('tab-updated');
      },
      onMonitorWindowRemoved: async () => {
        calls.push('window-removed');
      },
      logWarn: (...args) => {
        warnings.push(args.join(' '));
      },
    });

    api.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '3.5.1' });
    api.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: 1 });
    api.tabs.onRemoved.trigger(10);
    api.tabs.onUpdated.trigger(10, { url: 'https://example.com/' });
    api.windows.onRemoved.trigger(20);
    await flushAsyncListeners();

    expect(calls).toEqual([]);
    expect(warnings).toHaveLength(5);
    expect(warnings.every((warning) => warning.includes('storage migration failed'))).toBe(true);
  });

  test('runs monitor ticks only for the configured alarm name', async () => {
    const api = createLifecycleApi();
    let ticks = 0;
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingAutomation: inactiveAutomation,
      getInitPromise: () => null,
      onExtensionUpdate: async () => {},
      onAlarm: async () => {
        ticks += 1;
      },
      onManagedTabRemoved: async () => {},
      onManagedTabNavigatedAway: async () => {},
      onMonitorWindowRemoved: async () => {},
      logWarn: () => {},
    });

    api.alarms.onAlarm.trigger({ name: 'other', scheduledTime: 1 });
    api.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: 2 });
    await flushAsyncListeners();

    expect(ticks).toBe(1);
  });

  test('refreshes linked campaigns only for the configured recheck alarm prefix', async () => {
    const api = createLifecycleApi();
    const names: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingAutomation: inactiveAutomation,
      linkRecheckAlarmPrefix: 'campaignLinkRecheck:',
      getInitPromise: () => null,
      onExtensionUpdate: async () => {},
      onAlarm: async () => {},
      onLinkRecheckAlarm: async (alarm) => names.push(alarm.name),
      onManagedTabRemoved: async () => {},
      onManagedTabNavigatedAway: async () => {},
      onMonitorWindowRemoved: async () => {},
      logWarn: () => {},
    });

    api.alarms.onAlarm.trigger({ name: 'campaignLinkRecheck:1', scheduledTime: 1 });
    api.alarms.onAlarm.trigger({ name: 'unrelated:campaignLinkRecheck:1', scheduledTime: 2 });
    await flushAsyncListeners();

    expect(names).toEqual(['campaignLinkRecheck:1']);
  });

  test('reports managed-tab navigation only when the tab leaves Twitch', async () => {
    const api = createLifecycleApi();
    const navigations: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      farmingAutomation: inactiveAutomation,
      getInitPromise: () => null,
      onExtensionUpdate: async () => {},
      onAlarm: async () => {},
      onManagedTabRemoved: async () => {},
      onManagedTabNavigatedAway: async (_tabId, url) => {
        navigations.push(url);
      },
      onMonitorWindowRemoved: async () => {},
      logWarn: () => {},
    });

    api.tabs.onUpdated.trigger(10, { url: 'https://www.twitch.tv/example' });
    api.tabs.onUpdated.trigger(10, { url: 'https://example.com/' });
    api.tabs.onUpdated.trigger(10, {});
    await flushAsyncListeners();

    expect(navigations).toEqual(['https://example.com/']);
  });
});
