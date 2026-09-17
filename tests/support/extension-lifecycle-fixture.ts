import type { TabChangeInfo } from '../../src/background/extension-lifecycle.ts';

function createEvent<TArgs extends unknown[]>() {
  const handlers: Array<(...args: TArgs) => void> = [];
  return {
    addListener(handler: (...args: TArgs) => void) {
      handlers.push(handler);
    },
    trigger(...args: TArgs) {
      for (const handler of handlers) handler(...args);
    },
    handlers,
  };
}

export function createLifecycleApi() {
  return {
    runtime: {
      onStartup: createEvent<[]>(),
      onInstalled: createEvent<[chrome.runtime.InstalledDetails]>(),
    },
    alarms: { onAlarm: createEvent<[chrome.alarms.Alarm]>() },
    tabs: {
      onRemoved: createEvent<[number]>(),
      onUpdated: createEvent<[number, TabChangeInfo]>(),
    },
    windows: { onRemoved: createEvent<[number]>() },
  };
}

export async function flushAsyncListeners() {
  await Promise.resolve();
  await Promise.resolve();
}

export const inactiveAutomation = {
  async request() {
    return { kind: 'unchanged', reason: 'disabled' } as const;
  },
};
