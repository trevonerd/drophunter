import { expect, test } from 'bun:test';
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
      for (const handler of handlers) handler(...args);
    },
  };
}

test('deleting local app storage resets the live worker after initialization', async () => {
  const storageChanged = createEvent<[Record<string, chrome.storage.StorageChange>, 'local']>();
  const calls: string[] = [];
  registerExtensionLifecycleListeners({
    api: {
      runtime: {
        onStartup: createEvent<[]>(),
        onInstalled: createEvent<[chrome.runtime.InstalledDetails]>(),
      },
      storage: { onChanged: storageChanged },
      alarms: { onAlarm: createEvent<[chrome.alarms.Alarm]>() },
      tabs: {
        onRemoved: createEvent<[number]>(),
        onUpdated: createEvent<[number, TabChangeInfo]>(),
      },
      windows: { onRemoved: createEvent<[number]>() },
    },
    alarmName: 'dropCheck',
    farmingAutomation: {
      async request() {
        return { kind: 'unchanged', reason: 'disabled' } as const;
      },
    },
    getInitPromise: () => Promise.resolve().then(() => calls.push('init')),
    onExtensionUpdate: async () => {},
    onExtensionStorageCleared: async () => calls.push('reset'),
    onAlarm: async () => {},
    onManagedTabRemoved: async () => {},
    onManagedTabNavigatedAway: async () => {},
    onMonitorWindowRemoved: async () => {},
    logWarn: () => {},
  });

  storageChanged.trigger({ appState: { oldValue: { isRunning: true } } }, 'local');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['init', 'reset']);
});
