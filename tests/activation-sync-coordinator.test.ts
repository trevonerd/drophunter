import { describe, expect, test } from 'bun:test';
import {
  type ActivationSyncAttempt,
  type CampaignSyncState,
  createActivationSyncCoordinator,
} from '../src/background/activation-sync-coordinator.ts';
import { createDeferred, createTestClock, flushMicrotasks } from './support/farming-automation-fixtures.ts';

function idleState(lastSuccessAt: number | null = null): CampaignSyncState {
  return {
    status: 'idle',
    lastAttemptAt: lastSuccessAt,
    lastSuccessAt,
    campaignCount: lastSuccessAt === null ? null : 4,
    nextRetryAt: null,
  };
}

describe('ActivationSyncCoordinator', () => {
  test('popup activation uses a fresh authoritative campaign snapshot', async () => {
    const clock = createTestClock(1_000_000);
    let syncState = idleState(clock.now() - 10 * 60_000);
    const attempts: string[] = [];
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: async (next) => {
        syncState = next;
      },
      performSync: async (trigger) => {
        attempts.push(trigger);
        return { kind: 'synced', campaignCount: 5 };
      },
    });

    const result = await coordinator.request('popup-open');

    expect(result).toEqual({ kind: 'cache-fresh', campaignCount: 4 });
    expect(attempts).toEqual([]);
  });

  test('runs a stronger trigger immediately after an in-flight weaker request', async () => {
    const clock = createTestClock(2_000_000);
    let syncState = idleState();
    const firstAttempt = createDeferred<ActivationSyncAttempt>();
    const attempts: string[] = [];
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: async (next) => {
        syncState = next;
      },
      performSync: async (trigger) => {
        attempts.push(trigger);
        if (attempts.length === 1) return firstAttempt.promise;
        return { kind: 'synced', campaignCount: 8 };
      },
    });

    const periodic = coordinator.request('periodic-campaign');
    await flushMicrotasks();
    const wake = coordinator.request('wake');
    const popup = coordinator.request('popup-open');
    expect(attempts).toEqual(['periodic-campaign']);

    firstAttempt.resolve({ kind: 'synced', campaignCount: 7 });

    expect(await periodic).toEqual({ kind: 'synced', campaignCount: 7 });
    expect(await wake).toEqual({ kind: 'synced', campaignCount: 8 });
    expect(await popup).toEqual({ kind: 'synced', campaignCount: 8 });
    expect(attempts).toEqual(['periodic-campaign', 'wake']);
  });

  test('publishes needs-session without scheduling transient retries', async () => {
    const clock = createTestClock(3_000_000);
    let syncState = idleState();
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: async (next) => {
        syncState = next;
      },
      performSync: async () => ({ kind: 'needs-session' }),
    });

    expect(await coordinator.request('browser-start')).toEqual({ kind: 'needs-session' });
    expect(syncState).toEqual({
      status: 'needs-session',
      lastAttemptAt: clock.now(),
      lastSuccessAt: null,
      campaignCount: null,
      nextRetryAt: null,
    });
  });

  test('backs transient failures off at 1, 2, 5 and 10 minutes', async () => {
    const clock = createTestClock(4_000_000);
    let syncState = idleState();
    const scheduledRetries: number[] = [];
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: async (next) => {
        syncState = next;
      },
      scheduleRetry: (retryAt) => {
        scheduledRetries.push(retryAt);
      },
      performSync: async () => ({ kind: 'transient-error', error: 'offline' }),
    });

    const delays: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await coordinator.request('wake');
      expect(result.kind).toBe('retry-scheduled');
      if (result.kind === 'retry-scheduled') delays.push(result.retryAt - clock.now());
      clock.advance(20 * 60_000);
    }

    expect(delays).toEqual([60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 10 * 60_000]);
    expect(scheduledRetries).toHaveLength(5);
  });

  test('continues persisted retry backoff after a service-worker recycle', async () => {
    const clock = createTestClock(10_000);
    let syncState: CampaignSyncState = {
      status: 'retry-scheduled',
      lastAttemptAt: 8_000,
      lastSuccessAt: null,
      campaignCount: null,
      nextRetryAt: 8_000 + 2 * 60_000,
      error: 'offline',
    };
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      performSync: async () => ({ kind: 'transient-error', error: 'offline' }),
    });

    const result = await coordinator.request('wake');

    expect(result).toEqual({ kind: 'retry-scheduled', retryAt: clock.now() + 5 * 60_000, error: 'offline' });
  });

  test('does not let a routine progress alarm bypass a scheduled campaign retry', async () => {
    const clock = createTestClock(20_000);
    let syncState: CampaignSyncState = {
      status: 'retry-scheduled',
      lastAttemptAt: 10_000,
      lastSuccessAt: null,
      campaignCount: 3,
      nextRetryAt: 80_000,
      error: 'offline',
    };
    let attempts = 0;
    const coordinator = createActivationSyncCoordinator({
      now: clock.now,
      getCampaignSyncState: () => syncState,
      setCampaignSyncState: (next) => {
        syncState = next;
      },
      shouldRunPeriodicSync: () => true,
      performSync: async () => {
        attempts += 1;
        return { kind: 'synced', campaignCount: 4 };
      },
    });

    expect(await coordinator.request('periodic-campaign')).toEqual({
      kind: 'retry-scheduled',
      retryAt: 80_000,
      error: 'offline',
    });
    expect(attempts).toBe(0);

    clock.advance(60_000);
    expect(await coordinator.request('periodic-campaign')).toEqual({
      kind: 'synced',
      campaignCount: 4,
    });
    expect(attempts).toBe(1);
  });
});
