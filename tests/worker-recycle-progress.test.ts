import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import {
  clearPendingTimingStateSaveForTests,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import { browser } from '../src/shared/browser-api.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createDrop, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let chrome: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  chrome = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
});
afterEach(() => {
  clearPendingTimingStateSaveForTests();
  setTimingSaveDebounceMsForTests(null);
  chrome.teardown();
});

test('a recycled worker keeps farming after the first progress update with browser auto-resume disabled', async () => {
  const now = Date.now();
  const game = createGame({ campaignId: 'progressing-campaign' });
  const drop = createDrop({ campaignId: game.campaignId, progress: 1, currentMinutes: 1 });
  await chrome.storage.local.set({
    appState: {
      ...createInitialState(),
      isRunning: true,
      isPaused: false,
      manualQueueAuthorized: true,
      autoResumeOnStartup: false,
      queue: [game],
      selectedGame: game,
      availableGames: [game],
      allDrops: [drop],
      pendingDrops: [drop],
      currentDrop: drop,
    },
    lastActivityAt: now,
    timingState: { lastHeartbeatAt: now - 60_000 },
    [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
    [EXTENSION_VERSION_STORAGE_KEY]: browser.runtime.getManifest().version,
  });
  // Session storage survives MV3 worker termination, unlike a full browser restart.
  await chrome.storage.session.set({ farmingBrowserSessionSeen: true });
  const state = createServiceWorkerState();
  const events: string[] = [];
  const farming = {
    acquireStreamerForSelectedGame: async () => true,
    advanceQueueIfCompleted: async () => false,
    startMonitoring: () => {
      events.push('monitor');
    },
    stopMonitoring: () => {
      events.push('stop-monitor');
    },
    stop: async () => {},
  };
  const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });

  await lifecycle.beginInitialization(async () => {});

  expect(events).toEqual(['monitor']);
  expect(state.appState.isRunning).toBe(true);
  expect(state.appState.isPaused).toBe(false);
  expect(state.appState.currentDrop?.progress).toBe(1);
});
