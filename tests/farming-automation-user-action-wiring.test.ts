import { describe, expect, test } from 'bun:test';
import type { FarmingAutomation } from '../src/background/farming-automation.ts';
import { createFarmingAutomationUserActionHandlers } from '../src/background/service-worker-runtime-wiring.ts';

describe('farming automation user-action wiring', () => {
  test('invalidates automation before Pause, Resume, and Stop mutate durable session intent', async () => {
    const events: string[] = [];
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      invalidate: () => events.push('invalidate'),
      suppressCampaignUntilRefresh: async () => 'suppressed',
    };
    const actions = createFarmingAutomationUserActionHandlers(automation, {
      handlePauseFarming: async () => {
        events.push('pause');
        return { success: true };
      },
      handleResumeFarming: async () => {
        events.push('resume');
        return { success: true };
      },
      handleStopFarming: async () => {
        events.push('stop');
        return { success: true };
      },
    });

    const responses = [
      await actions.pauseFarming(),
      await actions.resumeFarming(),
      await actions.stopFarming(),
    ];

    expect(events).toEqual(['invalidate', 'pause', 'invalidate', 'resume', 'invalidate', 'stop']);
    expect(responses).toEqual([{ success: true }, { success: true }, { success: true }]);
  });

  test('returns the session action result without a second persistence channel', async () => {
    const automation: FarmingAutomation = {
      request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
      suppressCampaignUntilRefresh: async () => 'suppressed',
    };
    const actions = createFarmingAutomationUserActionHandlers(automation, {
      handlePauseFarming: async () => ({ success: true }),
      handleResumeFarming: async () => ({ success: true }),
      handleStopFarming: async () => ({ success: true }),
    });

    expect(await actions.pauseFarming()).toEqual({ success: true });
    expect(await actions.stopFarming()).toEqual({ success: true });
  });
});
