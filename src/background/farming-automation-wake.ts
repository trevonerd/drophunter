import { browser } from '../shared/browser-api.ts';
import { FARMING_AUTOMATION_DEADLINE_ALARM } from './farming-automation-browser.ts';

export type FarmingAutomationWakeResult = 'scheduled' | 'cleared' | 'failed';

export interface FarmingAutomationWake {
  readonly replaceDeadline: (at: number | null) => Promise<FarmingAutomationWakeResult>;
}

export function createChromeFarmingAutomationWake(): FarmingAutomationWake {
  return {
    async replaceDeadline(at) {
      try {
        await browser.alarms.clear(FARMING_AUTOMATION_DEADLINE_ALARM);
        if (at === null) {
          return 'cleared';
        }
        await browser.alarms.create(FARMING_AUTOMATION_DEADLINE_ALARM, { when: at });
        return 'scheduled';
      } catch (error) {
        if (error instanceof Error) {
          return 'failed';
        }
        throw error;
      }
    },
  };
}
