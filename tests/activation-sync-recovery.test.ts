import { describe, expect, test } from 'bun:test';
import {
  type CampaignSyncState,
  createActivationSyncCoordinator,
} from '../src/background/activation-sync-coordinator.ts';
import { createDeferred, createTestClock } from './support/farming-automation-fixtures.ts';

function idleState(): CampaignSyncState {
  return {
    status: 'idle',
    lastAttemptAt: null,
    lastSuccessAt: null,
    campaignCount: null,
    retryAttemptCount: 0,
    lastErrorKind: null,
    nextRetryAt: null,
    attemptDeadlineAt: null,
  };
}

describe('ActivationSyncCoordinator recovery', () => {
  test('persists retry count instead of deriving it from the retry clock', async () => {
    const clock = createTestClock(50_000);
    let syncState = idleState();
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      performSync: async () => ({ kind: 'transient-error', error: 'offline', errorKind: 'network' }),
    });
    await coordinator.request('wake');
    expect(syncState).toMatchObject({
      status: 'retry-scheduled',
      retryAttemptCount: 1,
      lastErrorKind: 'network',
    });
  });

  test('uses a rate-limit retry-after value instead of the local retry delay', async () => {
    const clock = createTestClock(70_000);
    let syncState = idleState();
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      performSync: async () => ({
        kind: 'transient-error',
        error: 'Too many requests.',
        errorKind: 'rate-limit',
        retryAfterMs: 4 * 60_000,
      }),
    });
    expect(await coordinator.request('wake')).toEqual({
      kind: 'retry-scheduled',
      retryAt: 310_000,
      error: 'Too many requests.',
    });
  });

  test('restores persisted retry without worker-start bypassing its alarm', async () => {
    const clock = createTestClock(90_000);
    let syncState: CampaignSyncState = {
      status: 'retry-scheduled',
      lastAttemptAt: 1_000,
      lastSuccessAt: null,
      campaignCount: null,
      retryAttemptCount: 3,
      lastErrorKind: 'integrity',
      nextRetryAt: 120_000,
      attemptDeadlineAt: null,
      error: 'Integrity refresh failed.',
    };
    const scheduledRetries: number[] = [];
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      scheduleRetry: (retryAt) => {
        scheduledRetries.push(retryAt);
      },
      performSync: async () => ({ kind: 'synced', campaignCount: 1 }),
    });
    await coordinator.initialize();
    expect(scheduledRetries).toEqual([120_000]);
    expect(await coordinator.request('worker-start')).toEqual({
      kind: 'retry-scheduled',
      retryAt: 120_000,
      error: 'Integrity refresh failed.',
    });
  });

  test('recovers an interrupted attempt no later than its persisted deadline', async () => {
    const clock = createTestClock(100_000);
    let syncState: CampaignSyncState = {
      status: 'syncing',
      lastAttemptAt: 95_000,
      lastSuccessAt: null,
      campaignCount: null,
      retryAttemptCount: 3,
      lastErrorKind: 'network',
      nextRetryAt: null,
      attemptDeadlineAt: 185_000,
    };
    const scheduledRetries: number[] = [];
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      scheduleRetry: (retryAt) => {
        scheduledRetries.push(retryAt);
      },
      performSync: async () => ({ kind: 'synced', campaignCount: 1 }),
    });
    await coordinator.initialize();
    expect(scheduledRetries).toEqual([185_000]);
    expect(syncState).toMatchObject({
      status: 'retry-scheduled',
      retryAttemptCount: 4,
      attemptDeadlineAt: null,
    });
  });

  test('retries reconciliation after a transient alarm failure', async () => {
    const clock = createTestClock(200_000);
    let syncState: CampaignSyncState = {
      status: 'retry-scheduled',
      lastAttemptAt: 100_000,
      lastSuccessAt: null,
      campaignCount: null,
      retryAttemptCount: 1,
      lastErrorKind: 'network',
      nextRetryAt: 260_000,
      attemptDeadlineAt: null,
      error: 'Offline.',
    };
    let scheduleCalls = 0;
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      scheduleRetry: () => {
        scheduleCalls += 1;
        if (scheduleCalls === 1) return Promise.reject(new Error('Alarm service unavailable.'));
      },
      performSync: async () => ({ kind: 'synced', campaignCount: 1 }),
    });
    await expect(coordinator.initialize()).rejects.toThrow('Alarm service unavailable.');
    await coordinator.initialize();
    expect(scheduleCalls).toBe(2);
  });

  test('bounds state publication and refresh work under one attempt deadline', async () => {
    const clock = createTestClock(300_000);
    let syncState = idleState();
    const syncingPublication = createDeferred<void>();
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      attemptTimeoutMs: 5,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
        return next.status === 'syncing' ? syncingPublication.promise : undefined;
      },
      performSync: async () => ({ kind: 'synced', campaignCount: 1 }),
    });
    expect(await coordinator.request('manual-retry')).toEqual({
      kind: 'retry-scheduled',
      retryAt: 360_000,
      error: 'Campaign sync timed out.',
    });
    expect(syncState).toMatchObject({ status: 'retry-scheduled', attemptDeadlineAt: null });
  });

  test('reports retry failure when the retry alarm cannot be created', async () => {
    const clock = createTestClock(400_000);
    let syncState = idleState();
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      scheduleRetry: () => Promise.reject(new Error('Alarm service unavailable.')),
      performSync: async () => ({ kind: 'transient-error', error: 'Offline.', errorKind: 'network' }),
    });

    expect(await coordinator.request('manual-retry')).toEqual({
      kind: 'retry-failed',
      error: 'Offline. Retry scheduling failed; retry manually.',
    });
    expect(syncState).toMatchObject({ status: 'retry-failed', nextRetryAt: null });
  });

  test('keeps a retry failure actionable until an explicit retry', async () => {
    const clock = createTestClock(500_000);
    let syncState: CampaignSyncState = {
      status: 'retry-failed',
      lastAttemptAt: 400_000,
      lastSuccessAt: null,
      campaignCount: null,
      retryAttemptCount: 1,
      lastErrorKind: 'network',
      nextRetryAt: null,
      attemptDeadlineAt: null,
      error: 'Retry scheduling failed; retry manually.',
    };
    let attempts = 0;
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      performSync: async () => {
        attempts += 1;
        return { kind: 'synced', campaignCount: 1 };
      },
    });
    expect(await coordinator.request('worker-start')).toEqual({
      kind: 'retry-failed',
      error: 'Retry scheduling failed; retry manually.',
    });
    expect(attempts).toBe(0);
    expect(await coordinator.request('manual-retry')).toEqual({ kind: 'synced', campaignCount: 1 });
  });
});
