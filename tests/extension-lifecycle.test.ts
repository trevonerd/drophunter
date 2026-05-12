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

describe('extension lifecycle listeners', () => {
  test('awaits initialization before handling an extension update', async () => {
    const api = createLifecycleApi();
    const calls: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
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

  test('runs monitor ticks only for the configured alarm name', async () => {
    const api = createLifecycleApi();
    let ticks = 0;
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
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

  test('reports managed-tab navigation only when the tab leaves Twitch', async () => {
    const api = createLifecycleApi();
    const navigations: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
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
