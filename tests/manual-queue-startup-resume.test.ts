import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
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
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
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

for (const idleHours of [1, 73]) {
  for (const legacyAutoResume of [false, true]) {
    test(`resumes an interrupted manual queue after ${idleHours} hours with favorites disabled and legacy resume ${legacyAutoResume}`, async () => {
      // Given: the same installed build restores a manually running queue with favorite automation disabled.
      const now = Date.now();
      const game = createGame({
        campaignId: 'manual-current',
        endsAt: new Date(now + 10 * 86_400_000).toISOString(),
      });
      const drop = createDrop({ campaignId: game.campaignId, progress: 42, currentMinutes: 25 });
      const persisted = {
        ...createInitialState(),
        isRunning: true,
        manualQueueAuthorized: true,
        farmingSessionOrigin: 'manual' as const,
        autoStartFavoriteGames: false,
        autoResumeOnStartup: legacyAutoResume,
        autoClaimDrops: false,
        totalDropsClaimed: 17,
        activeStreamer: createStreamer({ name: 'stale-streamer' }),
        tabId: 999,
        currentDrop: drop,
        allDrops: [drop],
        pendingDrops: [drop],
        queue: [game],
        selectedGame: game,
        availableGames: [game],
        queueEntryMetadataByKey: {
          [gameKey(game)]: {
            source: 'manual' as const,
            reason: 'user-added' as const,
            addedAt: now - idleHours * 3_600_000,
          },
        },
      };
      await chrome.storage.local.set({
        appState: persisted,
        dropsSnapshotCache: [drop],
        lastActivityAt: now - idleHours * 3_600_000,
        timingState: { lastHeartbeatAt: now - idleHours * 3_600_000 },
        [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
        [EXTENSION_VERSION_STORAGE_KEY]: browser.runtime.getManifest().version,
      });
      const state = createServiceWorkerState();
      const events: string[] = [];
      const farming = {
        advanceQueueIfCompleted: async () => true,
        acquireStreamerForSelectedGame: async () => {
          events.push(`acquire:${state.appState.selectedGame?.campaignId}`);
          state.appState.activeStreamer = createStreamer();
          return true;
        },
        handleStartFarming: async () => {
          events.push('start');
          return { success: true };
        },
        startMonitoring: () => {
          events.push('monitor');
        },
        stopMonitoring: () => {},
        stop: async () => {},
      };
      const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
      const activation = createServiceWorkerActivationSync({
        state,
        farmingSession: farming,
        automation: {
          request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
          snooze: async () => 'snoozed',
          suppressCampaignUntilRefresh: async () => 'suppressed',
        },
        refreshGamesCache: async () => {
          events.push('validated');
          return { kind: 'refreshed', games: [game], inventoryVerified: true };
        },
        dropsPageRefresher: {
          openDropsPageAndRefresh: async () => ({
            success: true,
            opened: false,
            refreshed: true,
            gamesCount: 1,
            inventoryVerified: true,
          }),
        },
      });
      // When: worker initialization restores storage and browser startup validates fresh Twitch data.
      await lifecycle.beginInitialization(async () => {});
      expect(state.appState.activeStreamer).toBeNull();
      expect(state.appState.tabId).toBeNull();
      await activation('browser-start', { signal: new AbortController().signal, isCurrent: () => true });
      // Then: prior manual intent, independent of favorites and the retired toggle, resumes only after validation.
      expect(state.appState.manualQueueAuthorized).toBe(true);
      expect(state.appState.farmingSessionOrigin).toBe('manual');
      expect(state.appState.isRunning).toBe(true);
      expect(events.filter((event) => event === 'validated' || event.startsWith('acquire:'))).toEqual([
        'validated',
        'acquire:manual-current',
      ]);
      expect(events).toContain('monitor');
      expect(state.appState.autoStartFavoriteGames).toBe(false);
      expect(state.appState.autoClaimDrops).toBe(false);
      expect(state.appState.totalDropsClaimed).toBe(17);
      expect(state.appState.currentDrop?.progress).toBe(42);
      expect(state.cachedDropsSnapshot[0]?.currentMinutes).toBe(25);
    });
  }
}

for (const idleHours of [1, 73]) {
  test.each([
    'paused',
    'stopped',
  ] as const)(`does not restart a %s manual queue after ${idleHours} hours`, async (status) => {
    // Given: a user deliberately paused or stopped a persisted manual queue.
    const game = createGame({ campaignId: 'manual-current' });
    await chrome.storage.local.set({
      appState: {
        ...createInitialState(),
        queue: [game],
        selectedGame: game,
        availableGames: [game],
        autoStartFavoriteGames: false,
        isRunning: status === 'paused',
        isPaused: status === 'paused',
        manualQueueAuthorized: status === 'paused',
        farmingSessionOrigin: status === 'paused' ? 'manual' : null,
        wasRunning: status === 'stopped',
        lastStopReason: status === 'stopped' ? 'user-stop' : null,
      },
      lastActivityAt: Date.now() - idleHours * 3_600_000,
      timingState: { lastHeartbeatAt: Date.now() - idleHours * 3_600_000 },
      [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      [EXTENSION_VERSION_STORAGE_KEY]: browser.runtime.getManifest().version,
    });
    const state = createServiceWorkerState();
    const started: string[] = [];
    const farming = {
      acquireStreamerForSelectedGame: async () => {
        started.push('acquire');
        return true;
      },
      advanceQueueIfCompleted: async () => false,
      handleStartFarming: async () => {
        started.push('start');
        return { success: true };
      },
      startMonitoring: () => {
        started.push('monitor');
      },
      stopMonitoring: () => {},
      stop: async () => {},
    };
    const lifecycle = createServiceWorkerStateLifecycle(state, { getFarmingSession: () => farming });
    // When: browser state is restored after worker restart or an entire weekend.
    await lifecycle.beginInitialization(async () => {});
    await createServiceWorkerActivationSync({
      state,
      farmingSession: farming,
      automation: {
        request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
        snooze: async () => 'snoozed',
        suppressCampaignUntilRefresh: async () => 'suppressed',
      },
      refreshGamesCache: async () => ({ kind: 'refreshed', games: [game], inventoryVerified: true }),
      dropsPageRefresher: {
        openDropsPageAndRefresh: async () => ({
          success: true,
          opened: false,
          refreshed: true,
          gamesCount: 1,
        }),
      },
    })('browser-start', { signal: new AbortController().signal, isCurrent: () => true });
    // Then: initialization preserves the explicit paused/stopped intent.
    expect(started).toEqual([]);
    expect(state.appState.isPaused).toBe(status === 'paused');
    expect(state.appState.isRunning).toBe(status === 'paused');
    expect(state.appState.manualQueueAuthorized).toBe(status === 'paused');
    if (status === 'stopped') expect(state.appState.lastStopReason).toBe('user-stop');
  });
}
