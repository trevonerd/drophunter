import { describe, expect, test } from 'bun:test';
import {
  initializeFarmingAutomationLifecycle,
  registerExtensionLifecycleListeners,
  type TabChangeInfo,
} from '../src/background/extension-lifecycle.ts';
import type {
  FarmingAutomationOutcome,
  FarmingAutomationTrigger,
} from '../src/background/farming-automation.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

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

function createLifecycleApi() {
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

async function flushAsyncListeners(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function unchanged(): FarmingAutomationOutcome {
  return { kind: 'unchanged', reason: 'disabled' };
}

describe('Farming automation lifecycle wiring', () => {
  test('maps startup periodic and deadline events', async () => {
    // Given: all public lifecycle events share one pending initialization.
    const api = createLifecycleApi();
    const log: string[] = [];
    const initialization = Promise.resolve().then(() => {
      log.push('initialized');
    });
    const automation = {
      async request(trigger: FarmingAutomationTrigger): Promise<FarmingAutomationOutcome> {
        log.push(trigger);
        return unchanged();
      },
    };
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      automationPeriodicAlarmName: 'favoriteCampaignCheck',
      automationDeadlineAlarmName: 'favoriteCampaignDeadline',
      farmingAutomation: automation,
      getInitPromise: () => initialization,
      onExtensionUpdate: async () => undefined,
      onAlarm: async () => undefined,
      onManagedTabRemoved: async () => undefined,
      onManagedTabNavigatedAway: async () => undefined,
      onMonitorWindowRemoved: async () => undefined,
      logWarn: () => undefined,
    });

    // When: browser startup and both automation alarms arrive together.
    api.runtime.onStartup.trigger();
    api.alarms.onAlarm.trigger({ name: 'favoriteCampaignCheck', scheduledTime: 1 });
    api.alarms.onAlarm.trigger({ name: 'favoriteCampaignDeadline', scheduledTime: 2 });
    await flushAsyncListeners();

    // Then: initialization wins and the deep public interface is the only automation path.
    expect(log).toEqual(['initialized', 'browser-start', 'periodic', 'periodic']);
  });

  test('reports rejected requests through lifecycle error handling', async () => {
    // Given: every public automation trigger rejects with one invariant error.
    const api = createLifecycleApi();
    const warnings: string[] = [];
    registerExtensionLifecycleListeners({
      api,
      alarmName: 'dropCheck',
      automationPeriodicAlarmName: 'favoriteCampaignCheck',
      automationDeadlineAlarmName: 'favoriteCampaignDeadline',
      farmingAutomation: {
        async request() {
          throw new Error('automation invariant');
        },
      },
      getInitPromise: () => null,
      onExtensionUpdate: async () => undefined,
      onAlarm: async () => undefined,
      onManagedTabRemoved: async () => undefined,
      onManagedTabNavigatedAway: async () => undefined,
      onMonitorWindowRemoved: async () => undefined,
      logWarn: (...args) => warnings.push(args.join(' ')),
    });

    // When: startup and both alarms dispatch asynchronously.
    api.runtime.onStartup.trigger();
    api.alarms.onAlarm.trigger({ name: 'favoriteCampaignCheck', scheduledTime: 1 });
    api.alarms.onAlarm.trigger({ name: 'favoriteCampaignDeadline', scheduledTime: 2 });
    await flushAsyncListeners();

    // Then: each rejection reaches the lifecycle reporter instead of escaping.
    expect(warnings).toHaveLength(3);
    expect(warnings.every((warning) => warning.includes('automation invariant'))).toBe(true);
  });

  test('distinguishes worker recycle from browser startup', async () => {
    // Given: a snoozed browser session and an overdue durable deadline survive a worker recycle.
    const chromeMocks = setupChromeMocks();
    const api = createLifecycleApi();
    const now = 20_000;
    let snoozed = true;
    const triggerLog: FarmingAutomationTrigger[] = [];
    const alarmLog: Array<
      | { readonly kind: 'periodic'; readonly minutes: number }
      | {
          readonly kind: 'deadline';
          readonly at: number | null;
        }
    > = [];
    const automation = {
      async request(trigger: FarmingAutomationTrigger): Promise<FarmingAutomationOutcome> {
        triggerLog.push(trigger);
        if (trigger === 'browser-start') snoozed = false;
        return unchanged();
      },
    };
    const initializeAutomation = () =>
      initializeFarmingAutomationLifecycle({
        automation,
        browser: {
          async schedulePeriodicAlarm(minutes) {
            alarmLog.push({ kind: 'periodic', minutes });
            return 'scheduled';
          },
          async replaceDeadlineAlarm(at) {
            alarmLog.push({ kind: 'deadline', at });
            return at === null ? 'cleared' : 'scheduled';
          },
        },
        persistence: {
          async loadFacts() {
            return {
              kind: 'ready',
              source: 'stored',
              value: {
                version: 1,
                lastPreemption: null,
                manualWatch: null,
                nextEvaluationAt: now - 1,
              },
            };
          },
        },
        recover: async () => ({ kind: 'ready', receipt: null, matchedCommittedTarget: false }),
        now: () => now,
      });
    const lifecycle = createServiceWorkerStateLifecycle(createServiceWorkerState(), {
      getFarmingSession: () => ({
        acquireStreamerForSelectedGame: async () => false,
        startMonitoring: () => undefined,
        stopMonitoring: () => undefined,
      }),
      initializeFarmingAutomation: initializeAutomation,
    });

    try {
      // When: the worker reconstructs, then a real browser startup event occurs.
      await lifecycle.beginInitialization(async () => undefined);
      const afterRecycle = snoozed;
      registerExtensionLifecycleListeners({
        api,
        alarmName: 'dropCheck',
        automationPeriodicAlarmName: 'favoriteCampaignCheck',
        automationDeadlineAlarmName: 'favoriteCampaignDeadline',
        farmingAutomation: automation,
        getInitPromise: lifecycle.getInitPromise,
        onExtensionUpdate: async () => undefined,
        onAlarm: async () => undefined,
        onManagedTabRemoved: async () => undefined,
        onManagedTabNavigatedAway: async () => undefined,
        onMonitorWindowRemoved: async () => undefined,
        logWarn: () => undefined,
      });
      api.runtime.onStartup.trigger();
      await flushAsyncListeners();

      // Then: recycle keeps snooze, clears the stale deadline, and evaluates exactly once before startup.
      expect({ afterRecycle, snoozed, triggerLog, alarmLog }).toEqual({
        afterRecycle: true,
        snoozed: false,
        triggerLog: ['periodic', 'browser-start'],
        alarmLog: [
          { kind: 'periodic', minutes: 2 },
          { kind: 'deadline', at: null },
        ],
      });
    } finally {
      chromeMocks.teardown();
    }
  });

  test('replaces a future durable deadline without evaluating early', async () => {
    // Given: a future deadline inside Chrome's minimum alarm delay.
    const deadlines: Array<number | null> = [];
    const triggers: FarmingAutomationTrigger[] = [];
    const now = 100_000;

    // When: the lifecycle reconstructs its durable wake-up facts.
    await initializeFarmingAutomationLifecycle({
      automation: {
        async request(trigger): Promise<FarmingAutomationOutcome> {
          triggers.push(trigger);
          return unchanged();
        },
      },
      browser: {
        schedulePeriodicAlarm: async () => 'scheduled',
        async replaceDeadlineAlarm(at) {
          deadlines.push(at);
          return at === null ? 'cleared' : 'scheduled';
        },
      },
      persistence: {
        async loadFacts() {
          return {
            kind: 'ready',
            source: 'stored',
            value: {
              version: 1,
              lastPreemption: null,
              manualWatch: null,
              nextEvaluationAt: now + 5_000,
            },
          };
        },
      },
      recover: async () => ({ kind: 'ready', receipt: null, matchedCommittedTarget: false }),
      now: () => now,
    });

    // Then: only the replaceable one-shot wake is clamped; no early policy request occurs.
    expect({ deadlines, triggers }).toEqual({ deadlines: [now + 30_000], triggers: [] });
  });
});
