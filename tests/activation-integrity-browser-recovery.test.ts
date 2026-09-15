import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import type { FarmingAutomation } from '../src/background/farming-automation.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { normalizeCampaignSyncState } from '../src/shared/app-state-runtime-normalizers.ts';

function fixture(
  hiddenSuccess: boolean,
  pageWait = Promise.resolve(),
  failureKind: 'integrity' | 'network' = 'integrity',
) {
  const state = createServiceWorkerState();
  const pageOptions: { active?: boolean; openIfMissing?: boolean; isCurrent?: () => boolean }[] = [];
  let evaluations = 0;
  let success = hiddenSuccess;
  let now = Date.now();
  const automation: FarmingAutomation = {
    request: async () => {
      evaluations += 1;
      return { kind: 'unchanged', reason: 'no-eligible-campaign' };
    },
    invalidate: () => {},
    snooze: async () => {},
    unsnooze: async () => {},
    initialize: async () => {},
  };
  const performSync = createServiceWorkerActivationSync({
    state,
    browserIntegrityTimeoutMs: 10,
    automation,
    refreshGamesCache: async () => ({
      kind: 'unavailable',
      failure: { kind: 'integrity', message: 'Integrity rejected after endpoint retries.' },
    }),
    farmingSession: {
      acquireStreamerForSelectedGame: async () => false,
      advanceQueueIfCompleted: async () => {},
      handleStartFarming: async () => ({ success: true }),
    },
    dropsPageRefresher: {
      openDropsPageAndRefresh: async (options) => {
        pageOptions.push(options ?? {});
        await pageWait;
        return {
          success,
          inventoryVerified: success,
          ...(success ? {} : { failure: { kind: failureKind, message: 'Browser verification rejected.' } }),
          opened: true,
          refreshed: success,
          gamesCount: success ? 4 : 0,
          error: success ? undefined : 'Browser verification still unavailable.',
        };
      },
    },
  });
  const makeCoordinator = () =>
    createActivationSyncCoordinator({
      now: () => now,
      getCampaignSyncState: () => state.appState.campaignSyncState,
      setCampaignSyncState: async (next) => {
        state.appState.campaignSyncState = next;
      },
      scheduleRetry: async () => {},
      clearRetry: async () => {},
      performSync,
    });
  return {
    state,
    pageOptions,
    makeCoordinator,
    evaluations: () => evaluations,
    advanceToRetry: () => {
      now = state.appState.campaignSyncState.nextRetryAt ?? now;
    },
    recover: () => {
      success = true;
    },
  };
}

test('API integrity exhaustion verifies silently through existing Drops page refresher and then evaluates automation', async () => {
  const run = fixture(true);
  expect((await run.makeCoordinator().request('worker-start')).kind).toBe('synced');
  expect(run.pageOptions).toEqual([expect.objectContaining({ active: false, openIfMissing: true })]);
  expect(run.evaluations()).toBe(1);
  expect(run.state.appState.campaignSyncState.status).toBe('idle');
  expect(run.state.appState.campaignSyncState.browserVerificationAttempted).toBeUndefined();
});

test('hung silent browser verification retries globally and invalidates late browser effects', async () => {
  let finish = () => {};
  const run = fixture(
    true,
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  expect((await run.makeCoordinator().request('worker-start')).kind).toBe('retry-scheduled');
  expect(run.state.appState.campaignSyncState.lastErrorKind).toBe('network');
  expect(run.state.appState.campaignSyncState.browserVerificationAttempted).toBeUndefined();
  expect(run.pageOptions[0]?.isCurrent?.()).toBe(false);
  finish();
  await Promise.resolve();
  expect(run.evaluations()).toBe(0);
  run.advanceToRetry();
  expect((await run.makeCoordinator().request('periodic-campaign')).kind).toBe('synced');
  expect(run.pageOptions).toHaveLength(2);
});

test('failed silent integrity verification requests action once across alarms and coordinator restart', async () => {
  const run = fixture(false);
  const coordinator = run.makeCoordinator();
  expect((await coordinator.request('worker-start')).kind).toBe('needs-session');
  expect(run.state.appState.campaignSyncState).toMatchObject({
    status: 'needs-session',
    lastErrorKind: 'integrity',
    nextRetryAt: null,
  });
  await coordinator.request('periodic-campaign');
  run.state.appState.campaignSyncState = normalizeCampaignSyncState({
    campaignSyncState: run.state.appState.campaignSyncState,
  });
  expect(run.state.appState.campaignSyncState.browserVerificationAttempted).toBe(true);
  await run.makeCoordinator().request('worker-start');
  expect(run.pageOptions).toHaveLength(1);
  expect(run.evaluations()).toBe(0);
  run.recover();
  expect((await coordinator.request('manual')).kind).toBe('synced');
  expect(run.pageOptions.at(-1)?.active).toBe(true);
  expect(run.evaluations()).toBe(1);
});

test('a transient browser network failure allows the scheduled integrity verification to recover without manual action', async () => {
  const run = fixture(false, Promise.resolve(), 'network');
  expect((await run.makeCoordinator().request('worker-start')).kind).toBe('retry-scheduled');
  expect(run.state.appState.campaignSyncState.lastErrorKind).toBe('network');
  run.recover();
  run.advanceToRetry();
  expect((await run.makeCoordinator().request('periodic-campaign')).kind).toBe('synced');
  expect(run.pageOptions).toHaveLength(2);
  expect(run.pageOptions.every((options) => options.active === false)).toBe(true);
  expect(run.evaluations()).toBe(1);
});
