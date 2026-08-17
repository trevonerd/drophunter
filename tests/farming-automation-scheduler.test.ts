import { describe, expect, test } from 'bun:test';
import type {
  FarmingAutomationOutcome,
  FarmingAutomationTrigger,
} from '../src/background/farming-automation.ts';
import { createFarmingAutomationScheduler } from '../src/background/farming-automation-scheduler.ts';
import { createDeferred, flushMicrotasks } from './support/farming-automation-fixtures.ts';
import { createFarmingAutomationHarness } from './support/farming-automation-harness.ts';

function unchanged(reason: 'disabled' | 'no-eligible-campaign'): FarmingAutomationOutcome {
  return { kind: 'unchanged', reason };
}

describe('FarmingAutomation scheduler', () => {
  test('runs one active and one shared trailing evaluation', async () => {
    const firstGate = createDeferred<FarmingAutomationOutcome>();
    const secondGate = createDeferred<FarmingAutomationOutcome>();
    const started: ReadonlySet<FarmingAutomationTrigger>[] = [];
    let active = 0;
    let maxActive = 0;
    const scheduler = createFarmingAutomationScheduler(async (triggers) => {
      started.push(triggers);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const result = started.length === 1 ? await firstGate.promise : await secondGate.promise;
      active -= 1;
      return result;
    });

    const first = scheduler.request('periodic');
    await flushMicrotasks();
    const second = scheduler.request('campaign-refresh');
    const third = scheduler.request('user-request');

    expect(second).not.toBe(first);
    expect(third).toBe(second);
    expect(scheduler.getStatus()).toMatchObject({ active: true, pending: true });
    expect(maxActive).toBe(1);

    firstGate.resolve(unchanged('disabled'));
    await flushMicrotasks();
    expect(started).toHaveLength(2);
    expect([...started[1]]).toEqual(['campaign-refresh', 'user-request']);
    expect(maxActive).toBe(1);

    secondGate.resolve(unchanged('no-eligible-campaign'));
    await expect(first).resolves.toEqual(unchanged('disabled'));
    await expect(second).resolves.toEqual(unchanged('no-eligible-campaign'));
    expect(scheduler.getStatus()).toEqual({
      active: false,
      pending: false,
      activeTriggerCount: 0,
      pendingTriggerCount: 0,
    });
  });

  test('starts trailing work even when the active evaluation rejects', async () => {
    const firstGate = createDeferred<FarmingAutomationOutcome>();
    const secondGate = createDeferred<FarmingAutomationOutcome>();
    const started: string[][] = [];
    const scheduler = createFarmingAutomationScheduler(async (triggers) => {
      started.push([...triggers]);
      if (started.length === 1) return firstGate.promise;
      return secondGate.promise;
    });

    const first = scheduler.request('periodic');
    const trailing = scheduler.request('browser-start');
    firstGate.reject(new Error('refresh failed'));
    await expect(first).rejects.toThrow('refresh failed');
    await flushMicrotasks();

    expect(started).toEqual([['periodic'], ['browser-start']]);
    secondGate.resolve(unchanged('disabled'));
    await expect(trailing).resolves.toEqual(unchanged('disabled'));
  });

  test('assigns a third promise when a request arrives during trailing work', async () => {
    const gates = [
      createDeferred<FarmingAutomationOutcome>(),
      createDeferred<FarmingAutomationOutcome>(),
      createDeferred<FarmingAutomationOutcome>(),
    ];
    const started: string[][] = [];
    const scheduler = createFarmingAutomationScheduler(async (triggers) => {
      const index = started.length;
      started.push([...triggers]);
      return gates[index].promise;
    });

    const first = scheduler.request('periodic');
    const trailing = scheduler.request('campaign-refresh');
    gates[0].resolve(unchanged('disabled'));
    await flushMicrotasks();
    const third = scheduler.request('user-request');

    expect(third).not.toBe(first);
    expect(third).not.toBe(trailing);
    gates[1].resolve(unchanged('disabled'));
    await flushMicrotasks();
    expect(started).toEqual([['periodic'], ['campaign-refresh'], ['user-request']]);
    gates[2].resolve(unchanged('no-eligible-campaign'));

    await expect(first).resolves.toEqual(unchanged('disabled'));
    await expect(trailing).resolves.toEqual(unchanged('disabled'));
    await expect(third).resolves.toEqual(unchanged('no-eligible-campaign'));
  });

  test('public automation keeps snooze separate from request scheduling', async () => {
    const harness = createFarmingAutomationHarness();
    await expect(harness.automation.snooze('manual-pause')).resolves.toBe('snoozed');
    expect(await harness.persistence.getSession('autoStartSnoozedForBrowserSession')).toBe(true);
    expect(harness.scheduler.getStatus()).toMatchObject({ active: false, pending: false });
  });

  test('invalidating an active run resolves it as superseded', async () => {
    const gate = createDeferred<FarmingAutomationOutcome>();
    const scheduler = createFarmingAutomationScheduler(async () => gate.promise);
    const request = scheduler.request('periodic');
    scheduler.invalidate();
    gate.resolve({ kind: 'started', campaignKey: 'campaign-1', transition: 'start' });

    await expect(request).resolves.toEqual({
      kind: 'unchanged',
      reason: 'superseded-by-state-change',
    });
  });
});
