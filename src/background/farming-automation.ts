import type { FarmingAutomation } from './farming-automation-contracts.ts';
import {
  createFarmingAutomationEvaluator,
  type FarmingAutomationEvaluatorDependencies,
  type FarmingAutomationRuntime,
} from './farming-automation-evaluator.ts';
import {
  createFarmingAutomationManualWatch,
  type FarmingAutomationManualWatchController,
} from './farming-automation-manual-watch.ts';
import {
  createFarmingAutomationScheduler,
  type FarmingAutomationEvaluateBatch,
  type FarmingAutomationScheduler,
} from './farming-automation-scheduler.ts';

export type {
  FarmingAutomation,
  FarmingAutomationFailureReason,
  FarmingAutomationOutcome,
  FarmingAutomationTrigger,
  FarmingAutomationUnchangedReason,
} from './farming-automation-contracts.ts';

interface FarmingAutomationHarnessDependencies {
  readonly evaluateBatch: FarmingAutomationEvaluateBatch;
  readonly persistSnooze?: (
    reason: 'manual-pause' | 'manual-stop',
  ) => Promise<'snoozed' | 'persistence-failed'>;
  readonly scheduler?: FarmingAutomationScheduler;
}

export type FarmingAutomationDependencies =
  | FarmingAutomationHarnessDependencies
  | (Omit<FarmingAutomationEvaluatorDependencies, 'manualWatch' | 'runtime' | 'now' | 'random'> & {
      readonly manualWatch?: FarmingAutomationManualWatchController;
      readonly now?: () => number;
      readonly random?: () => number;
    });

function isHarnessDependencies(
  dependencies: FarmingAutomationDependencies,
): dependencies is FarmingAutomationHarnessDependencies {
  return 'evaluateBatch' in dependencies;
}

export function createFarmingAutomation(dependencies: FarmingAutomationDependencies): FarmingAutomation {
  if (isHarnessDependencies(dependencies)) {
    const scheduler = dependencies.scheduler ?? createFarmingAutomationScheduler(dependencies.evaluateBatch);
    return {
      request: scheduler.request,
      async snooze(reason) {
        scheduler.invalidate();
        if (!dependencies.persistSnooze) return 'snoozed';
        try {
          return await dependencies.persistSnooze(reason);
        } catch (error) {
          if (error instanceof Error) return 'persistence-failed';
          throw error;
        }
      },
    };
  }
  const runtime: FarmingAutomationRuntime = { generation: 0, snoozed: false };
  const manualWatch =
    dependencies.manualWatch ??
    createFarmingAutomationManualWatch({
      persistence: dependencies.persistence,
      observeManualTabs: dependencies.browser.observeManualTabs,
      replaceDeadline: dependencies.browser.replaceDeadlineAlarm,
      now: dependencies.now,
    });
  const evaluateBatch = createFarmingAutomationEvaluator({
    ...dependencies,
    manualWatch,
    runtime,
    now: dependencies.now ?? Date.now,
    random: dependencies.random ?? Math.random,
  });
  const scheduler = createFarmingAutomationScheduler(evaluateBatch);
  return {
    request: scheduler.request,
    async snooze() {
      runtime.generation += 1;
      runtime.snoozed = true;
      scheduler.invalidate();
      try {
        const persisted = await dependencies.persistence.setSnooze();
        return persisted.kind === 'written' ? 'snoozed' : 'persistence-failed';
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return 'persistence-failed';
      }
    },
  };
}
