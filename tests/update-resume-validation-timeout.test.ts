import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createCampaignFixture, createDeferred } from './support/farming-automation-fixtures.ts';

test.each([
  'direct',
  'browser',
] as const)('pending update queue receives a durable retry after validated %s discovery hangs', async (path) => {
  const state = createServiceWorkerState();
  const game = createCampaignFixture();
  Object.assign(state.appState, {
    selectedGame: game,
    queue: [game],
    availableGames: [game],
    wasRunning: true,
    manualQueueAuthorized: true,
    autoStartFavoriteGames: false,
  });
  const release = createDeferred<void>();
  let attempts = 0;
  let starts = 0;
  let now = Date.now();
  const retries: number[] = [];
  const performSync = createServiceWorkerActivationSync({
    state,
    refreshGamesCache: async () =>
      path === 'direct'
        ? { kind: 'refreshed', games: [game], inventoryVerified: true }
        : { kind: 'cached', games: [] },
    dropsPageRefresher: {
      openDropsPageAndRefresh: async () => ({
        success: true,
        opened: false,
        refreshed: true,
        gamesCount: 1,
        inventoryVerified: true,
      }),
    },
    farmingSession: {
      acquireStreamerForSelectedGame: async () => false,
      advanceQueueIfCompleted: async () => true,
      handleStartFarming: async () => {
        starts += 1;
        state.appState.isRunning = true;
        return { success: true };
      },
    },
    automation: {
      request: async () => {
        if (++attempts === 1) await release.promise;
        return { kind: 'unchanged', reason: 'disabled' };
      },
      snooze: async () => 'snoozed',
      suppressCampaignUntilRefresh: async () => 'suppressed',
    },
  });
  const coordinator = createActivationSyncCoordinator({
    now: () => now,
    attemptTimeoutMs: 20,
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: (sync) => {
      state.appState.campaignSyncState = sync;
    },
    scheduleRetry: (at) => {
      retries.push(at);
    },
    performSync,
  });
  const result = await coordinator.request('extension-update');
  release.resolve();
  expect(result.kind).toBe('retry-scheduled');
  expect(state.appState.campaignSyncState.status).toBe('retry-scheduled');
  expect(retries[0]).toBeGreaterThan(now);
  expect(starts).toBe(0);
  now = retries[0] ?? now;
  expect((await coordinator.request('wake')).kind).toBe('synced');
  expect(starts).toBe(1);
  expect(state.appState.wasRunning).toBe(false);
});
