import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createCampaignFixture, createDeferred } from './support/farming-automation-fixtures.ts';

test.each([
  'synchronous',
  'asynchronous',
] as const)('does not confirm validation when publication fails: %s', async (failure) => {
  const state = createServiceWorkerState();
  const coordinator = createActivationSyncCoordinator({
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: (sync) => {
      if (sync.status === 'idle') {
        const error = new TypeError('Campaign state save failed');
        if (failure === 'synchronous') throw error;
        return Promise.reject(error);
      }
      state.appState.campaignSyncState = sync;
    },
    performSync: async (_trigger, execution) => {
      await execution.confirmCampaignValidation?.(1);
      return { kind: 'synced', campaignCount: 1 };
    },
  });
  expect((await coordinator.request('wake')).kind).toBe('retry-scheduled');
  expect(state.appState.campaignSyncState.status).toBe('retry-scheduled');
});

test('a timeout while saving validation cannot become a late success', async () => {
  const state = createServiceWorkerState();
  const releaseSave = createDeferred<void>();
  const finished = createDeferred<void>();
  const coordinator = createActivationSyncCoordinator({
    attemptTimeoutMs: 20,
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: async (sync) => {
      state.appState.campaignSyncState = sync;
      if (sync.status === 'idle') await releaseSave.promise;
    },
    performSync: async (_trigger, execution) => {
      await execution.confirmCampaignValidation?.(1);
      finished.resolve(undefined);
      return { kind: 'synced', campaignCount: 1 };
    },
  });
  const result = await coordinator.request('wake');
  releaseSave.resolve(undefined);
  await finished.promise;
  expect(result.kind).toBe('retry-scheduled');
  expect(state.appState.campaignSyncState.status).toBe('retry-scheduled');
});

test.each([
  { inventoryVerified: true, downstream: 'timeout' },
  { inventoryVerified: true, downstream: 'rejection' },
  { inventoryVerified: false, downstream: 'timeout' },
] as const)('validation checkpoint requires full proof and survives downstream failure: %j', async ({
  inventoryVerified,
  downstream,
}) => {
  const state = createServiceWorkerState();
  const game = createCampaignFixture();
  state.appState.availableGames = [game];
  const enteredDiscovery = createDeferred<void>();
  const releaseDiscovery = createDeferred<void>();
  const performSync = createServiceWorkerActivationSync({
    state,
    refreshGamesCache: async () => ({ kind: 'refreshed', games: [game], inventoryVerified }),
    dropsPageRefresher: {
      openDropsPageAndRefresh: async () => ({ success: false, opened: false, error: 'Unexpected fallback' }),
    },
    farmingSession: {
      acquireStreamerForSelectedGame: async () => false,
      advanceQueueIfCompleted: async () => true,
      handleStartFarming: async () => ({ success: false }),
    },
    automation: {
      request: async () => {
        enteredDiscovery.resolve(undefined);
        if (downstream === 'rejection') throw new TypeError('Directory discovery failed');
        await releaseDiscovery.promise;
        return { kind: 'unchanged', reason: 'no-eligible-campaign' };
      },
      snooze: async () => 'snoozed',
      suppressCampaignUntilRefresh: async () => 'suppressed',
    },
  });
  const retries: number[] = [];
  const coordinator = createActivationSyncCoordinator({
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

  const pending = coordinator.request('wake');
  await enteredDiscovery.promise;
  const statusWhileDiscovering = state.appState.campaignSyncState.status;
  const result = await pending;
  releaseDiscovery.resolve(undefined);

  expect(statusWhileDiscovering).toBe(inventoryVerified ? 'idle' : 'syncing');
  if (inventoryVerified) {
    expect(result).toEqual({ kind: 'synced', campaignCount: 1 });
    expect(state.appState.campaignSyncState.status).toBe('idle');
    expect(retries).toEqual([]);
  } else {
    expect(result.kind).toBe('retry-scheduled');
    expect(state.appState.campaignSyncState.status).toBe('retry-scheduled');
    expect(retries).toHaveLength(1);
  }
});

test.each([
  false,
  true,
])('a superseded validation checkpoint cannot overwrite the newer result: %s', async (confirmedBeforeSupersession) => {
  const state = createServiceWorkerState();
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const finished = createDeferred<void>();
  const coordinator = createActivationSyncCoordinator({
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: (sync) => {
      state.appState.campaignSyncState = sync;
    },
    performSync: async (trigger, execution) => {
      if (trigger === 'manual') return { kind: 'needs-session', errorKind: 'auth' };
      if (confirmedBeforeSupersession) await execution.confirmCampaignValidation?.(1);
      entered.resolve(undefined);
      await release.promise;
      await execution.confirmCampaignValidation?.(1);
      finished.resolve(undefined);
      return { kind: 'synced', campaignCount: 1 };
    },
  });
  const oldRequest = coordinator.request('wake');
  await entered.promise;
  expect(await coordinator.request('manual')).toEqual({ kind: 'needs-session', errorKind: 'auth' });
  release.resolve(undefined);
  await finished.promise;
  expect(await oldRequest).toEqual({ kind: 'not-needed' });
  expect(state.appState.campaignSyncState.status).toBe('needs-session');
  expect(state.appState.campaignSyncState.lastErrorKind).toBe('auth');
});
