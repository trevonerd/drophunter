import { expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('wake replaces an expired activation without waiting for its suspended timer', async () => {
  // Given a sync whose external operation has not settled before laptop sleep.
  let now = 1_000_000;
  let state = createInitialState().campaignSyncState;
  const entered = Promise.withResolvers<void>();
  const blocked = Promise.withResolvers<never>();
  let originalIsCurrent: (() => boolean) | undefined;
  let calls = 0;
  const coordinator = createActivationSyncCoordinator({
    now: () => now,
    getCampaignSyncState: () => state,
    setCampaignSyncState: (next) => {
      state = next;
    },
    performSync: async (_trigger, execution) => {
      calls += 1;
      if (calls === 1) {
        originalIsCurrent = execution.isCurrent;
        entered.resolve();
        return blocked.promise;
      }
      return { kind: 'synced', campaignCount: 4 };
    },
  });
  const first = coordinator.request('manual');
  await entered.promise;
  now += 72 * 60 * 60_000;

  // When a lower-priority periodic event arrives after the operation deadline.
  const staleCanCommit = originalIsCurrent?.();
  const next = coordinator.request('periodic-campaign');
  if (staleCanCommit) {
    // Release the pre-fix implementation without waiting for real timers.
    blocked.reject(new DOMException('Test operation released', 'AbortError'));
  }
  const result = await next;
  await first;

  // Then stale work cannot publish and a fresh attempt validates the catalog.
  expect(staleCanCommit).toBe(false);
  expect(calls).toBe(2);
  expect(result.kind).toBe('synced');
});
