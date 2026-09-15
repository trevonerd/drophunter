import { expect, test } from 'bun:test';
import {
  type ExtensionLifecycleApi,
  registerExtensionLifecycleListeners,
} from '../src/background/extension-lifecycle.ts';

test('browser startup validates saved campaign state before evaluating automatic farming', async () => {
  // Given a restored queue and a validation operation that has not completed.
  const validation = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let startup: (() => void) | undefined;
  const calls: string[] = [];
  const ignoredEvent = { addListener: () => {} };
  const api: ExtensionLifecycleApi = {
    runtime: {
      onStartup: {
        addListener: (handler) => {
          startup = handler;
        },
      },
      onInstalled: ignoredEvent,
    },
    alarms: { onAlarm: ignoredEvent },
    tabs: { onRemoved: ignoredEvent, onUpdated: ignoredEvent },
    windows: { onRemoved: ignoredEvent },
  };
  registerExtensionLifecycleListeners({
    api,
    alarmName: 'dropCheck',
    getInitPromise: () => null,
    farmingAutomation: {
      request: async () => {
        calls.push('acquisition');
        finished.resolve();
        return { kind: 'unchanged', reason: 'disabled' };
      },
    },
    onActivationSync: async () => {
      calls.push('validation');
      await validation.promise;
    },
    onExtensionUpdate: async () => {},
    onAlarm: async () => {},
    onManagedTabRemoved: async () => {},
    onManagedTabNavigatedAway: async () => {},
    onMonitorWindowRemoved: async () => {},
    logWarn: () => {},
  });

  // When browser startup arrives and validation subsequently completes.
  startup?.();
  await Promise.resolve();
  await Promise.resolve();
  const beforeValidationFinished = calls.slice();
  validation.resolve();
  await finished.promise;

  // Then startup acquisition cannot overtake campaign validation.
  expect(beforeValidationFinished).toEqual(['validation']);
  expect(calls).toEqual(['validation', 'acquisition']);
});
