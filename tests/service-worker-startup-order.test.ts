import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

describe('service worker startup dependencies', () => {
  test.each([
    false,
    true,
  ])('initializes automation before resuming a saved session (expired campaign: %p)', async (expired) => {
    const mocks = setupChromeMocks();
    try {
      const state = createServiceWorkerState();
      const campaign = {
        id: 'game-a',
        campaignId: 'campaign-a',
        name: 'Game A',
        imageUrl: '',
        endsAt: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(),
      };
      await mocks.storage.local.set({
        [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
        [EXTENSION_VERSION_STORAGE_KEY]: mocks.runtime.getManifest().version,
        appState: {
          ...state.appState,
          isRunning: true,
          selectedGame: campaign,
          queue: [campaign],
        },
      });
      const events: string[] = [];
      let automationReady = false;
      const lifecycle = createServiceWorkerStateLifecycle(state, {
        initializeFarmingAutomation: async () => {
          expect(state.appState.selectedGame?.campaignId).toBe('campaign-a');
          automationReady = true;
          events.push('automation-ready');
        },
        getFarmingSession: () => ({
          acquireStreamerForSelectedGame: async () => true,
          advanceQueueIfCompleted: async () => {
            // Queue advancement can await automation campaign suppression.
            expect(automationReady).toBe(true);
            events.push('advance');
            return true;
          },
          startMonitoring: () => {
            expect(automationReady).toBe(true);
            events.push('monitor');
          },
          stop: async () => undefined,
          stopMonitoring: () => undefined,
        }),
      });

      await lifecycle.beginInitialization(async () => {
        events.push('after-load');
      });

      expect(events).toEqual(
        expired
          ? ['automation-ready', 'advance', 'monitor', 'after-load']
          : ['automation-ready', 'monitor', 'after-load'],
      );
    } finally {
      mocks.teardown();
    }
  });

  test.each([
    'fresh',
    'paused',
    'failed',
  ] as const)('does not start monitoring for %s initialization', async (scenario) => {
    const mocks = setupChromeMocks();
    try {
      const state = createServiceWorkerState();
      if (scenario !== 'fresh') {
        await mocks.storage.local.set({
          [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
          [EXTENSION_VERSION_STORAGE_KEY]: mocks.runtime.getManifest().version,
          appState: { ...state.appState, isRunning: true, isPaused: scenario === 'paused' },
        });
      }
      let monitorStarts = 0;
      let afterLoadCalls = 0;
      const failure = new Error('automation storage unavailable');
      const lifecycle = createServiceWorkerStateLifecycle(state, {
        initializeFarmingAutomation: async () => {
          if (scenario === 'failed') throw failure;
        },
        getFarmingSession: () => ({
          acquireStreamerForSelectedGame: async () => true,
          advanceQueueIfCompleted: async () => true,
          startMonitoring: () => {
            monitorStarts += 1;
          },
          stop: async () => undefined,
          stopMonitoring: () => undefined,
        }),
      });
      const initialization = lifecycle.beginInitialization(async () => {
        afterLoadCalls += 1;
      });
      if (scenario === 'failed') {
        await expect(initialization).rejects.toBe(failure);
      } else {
        await initialization;
      }
      expect(monitorStarts).toBe(0);
      expect(afterLoadCalls).toBe(scenario === 'failed' ? 0 : 1);
    } finally {
      mocks.teardown();
    }
  });
});
