import { describe, expect, test } from 'bun:test';
import type { FarmingAutomation } from '../src/background/farming-automation.ts';
import { createFarmingAutomationUserActionHandlers } from '../src/background/service-worker-runtime-wiring.ts';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('farming automation user-action wiring', () => {
  test('applies user action and surfaces snooze failure', async () => {
    // Given pause and stop snoozes whose synchronous invalidation precedes a blocked persistence write.
    const events: string[] = [];
    let persistence = deferred();
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      snooze: async (reason) => {
        events.push(`${reason}:invalidate`);
        await persistence.promise;
        events.push(`${reason}:persistence-failed`);
        return 'persistence-failed';
      },
    };
    const actions = createFarmingAutomationUserActionHandlers(automation, {
      handlePauseFarming: async () => {
        events.push('pause:action');
        return { success: true };
      },
      handleStopFarming: async () => {
        events.push('stop:action');
        return { success: true };
      },
    });

    // When each request reaches the storage barrier and that persistence attempt fails.
    const pause = actions.pauseFarming();
    await Promise.resolve();
    expect(events).toEqual(['manual-pause:invalidate']);
    persistence.resolve();
    const pauseResponse = await pause;
    persistence = deferred();
    const stop = actions.stopFarming();
    await Promise.resolve();
    expect(events).toEqual([
      'manual-pause:invalidate',
      'manual-pause:persistence-failed',
      'pause:action',
      'manual-stop:invalidate',
    ]);
    persistence.resolve();
    const stopResponse = await stop;

    // Then both user actions run exactly once and neither response reports a false clean success.
    expect(events).toEqual([
      'manual-pause:invalidate',
      'manual-pause:persistence-failed',
      'pause:action',
      'manual-stop:invalidate',
      'manual-stop:persistence-failed',
      'stop:action',
    ]);
    expect(pauseResponse).toEqual({
      success: false,
      error: 'Farming paused, but the automatic-farming snooze could not be persisted.',
    });
    expect(stopResponse).toEqual({
      success: false,
      error: 'Farming stopped, but the automatic-farming snooze could not be persisted.',
    });
  });

  test('keeps resume outside snooze and preserves clean action success', async () => {
    // Given a persisted snooze and three successful Farming session actions.
    const snoozeReasons: string[] = [];
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      snooze: async (reason) => {
        snoozeReasons.push(reason);
        return 'snoozed';
      },
    };
    const actions = createFarmingAutomationUserActionHandlers(automation, {
      handlePauseFarming: async () => ({ success: true }),
      handleResumeFarming: async () => ({ success: true }),
      handleStopFarming: async () => ({ success: true }),
    });

    // When pause, resume, and stop are requested in order.
    const responses = [
      await actions.pauseFarming(),
      await actions.resumeFarming(),
      await actions.stopFarming(),
    ];

    // Then only pause and stop create snoozes, while clean responses remain unchanged.
    expect(snoozeReasons).toEqual(['manual-pause', 'manual-stop']);
    expect(responses).toEqual([{ success: true }, { success: true }, { success: true }]);
  });
});
