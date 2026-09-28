import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import type { CampaignSyncState } from '../src/types/activation-sync.ts';

test('failed retry scheduling cannot suppress later periodic campaign validation forever', async () => {
  let now = 1_000_000;
  let sync: CampaignSyncState = {
    status: 'retry-failed',
    lastAttemptAt: now,
    lastErrorKind: 'network',
    retryAttemptCount: 1,
    lastSuccessAt: null,
    campaignCount: null,
    nextRetryAt: null,
    attemptDeadlineAt: null,
    error: 'Alarm unavailable',
  };
  let attempts = 0;
  const coordinator = createActivationSyncCoordinator({
    now: () => now,
    getCampaignSyncState: () => sync,
    setCampaignSyncState: (next) => {
      sync = next;
    },
    performSync: async () => {
      attempts += 1;
      return { kind: 'synced', campaignCount: 1 };
    },
  });
  expect((await coordinator.request('periodic-campaign')).kind).toBe('retry-failed');
  now += 600_000;
  expect((await coordinator.request('periodic-campaign')).kind).toBe('synced');
  expect(attempts).toBe(1);
});
