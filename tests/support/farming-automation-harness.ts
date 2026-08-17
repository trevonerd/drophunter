import {
  createFarmingAutomation,
  type FarmingAutomation,
  type FarmingAutomationOutcome,
  type FarmingAutomationTrigger,
} from '../../src/background/farming-automation.ts';
import {
  createFarmingAutomationScheduler,
  type FarmingAutomationScheduler,
} from '../../src/background/farming-automation-scheduler.ts';
import type { FarmingAutomationBrowser } from './farming-automation-browser.ts';
import { createFarmingAutomationBrowser } from './farming-automation-browser.ts';
import type { TestClock } from './farming-automation-fixtures.ts';
import { createTestClock } from './farming-automation-fixtures.ts';
import type { FarmingAutomationPersistence } from './farming-automation-persistence.ts';
import { createFarmingAutomationPersistence } from './farming-automation-persistence.ts';
import type { FarmingAutomationTwitch } from './farming-automation-twitch.ts';
import { createFarmingAutomationTwitch } from './farming-automation-twitch.ts';

export interface FarmingAutomationHarness {
  readonly automation: FarmingAutomation;
  readonly scheduler: FarmingAutomationScheduler;
  readonly clock: TestClock;
  readonly twitch: FarmingAutomationTwitch;
  readonly browser: FarmingAutomationBrowser;
  readonly persistence: FarmingAutomationPersistence;
  readonly batches: readonly ReadonlySet<FarmingAutomationTrigger>[];
  readonly reconstruct: () => FarmingAutomationHarness;
  readonly restartBrowser: () => void;
}

export interface FarmingAutomationHarnessOptions {
  readonly evaluateBatch?: (
    triggers: ReadonlySet<FarmingAutomationTrigger>,
    harness: FarmingAutomationHarness,
  ) => Promise<FarmingAutomationOutcome>;
  readonly persistence?: FarmingAutomationPersistence;
  readonly clock?: TestClock;
}

function defaultOutcome(): FarmingAutomationOutcome {
  return { kind: 'unchanged', reason: 'disabled' };
}

export function createFarmingAutomationHarness(
  options: FarmingAutomationHarnessOptions = {},
): FarmingAutomationHarness {
  const clock = options.clock ?? createTestClock();
  const twitch = createFarmingAutomationTwitch();
  const browser = createFarmingAutomationBrowser();
  const persistence = options.persistence ?? createFarmingAutomationPersistence();
  const batches: ReadonlySet<FarmingAutomationTrigger>[] = [];
  let harness: FarmingAutomationHarness;
  const evaluateBatch = async (triggers: ReadonlySet<FarmingAutomationTrigger>) => {
    batches.push(new Set(triggers));
    return options.evaluateBatch ? options.evaluateBatch(triggers, harness) : defaultOutcome();
  };
  const scheduler = createFarmingAutomationScheduler(evaluateBatch);
  const automation = createFarmingAutomation({
    evaluateBatch,
    persistSnooze: async () => {
      try {
        await persistence.setSession('autoStartSnoozedForBrowserSession', true);
        return 'snoozed';
      } catch {
        return 'persistence-failed';
      }
    },
    scheduler,
  });
  harness = {
    automation,
    scheduler,
    clock,
    twitch,
    browser,
    persistence,
    batches,
    reconstruct: () =>
      createFarmingAutomationHarness({
        evaluateBatch: options.evaluateBatch,
        persistence: persistence.reconstruct(),
        clock,
      }),
    restartBrowser: () => persistence.restartBrowser(),
  };
  return harness;
}
