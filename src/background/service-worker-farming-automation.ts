import type { FarmingAutomation } from './farming-automation-contracts.ts';
import type { FarmingAutomationManualWatchController } from './farming-automation-manual-watch.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  assembleServiceWorkerFarmingAutomation,
  type ServiceWorkerFarmingAutomationAssemblyDependencies,
} from './service-worker-farming-automation-assembly.ts';

type InitializationResult =
  | {
      readonly kind: 'ready';
      readonly automation: FarmingAutomation;
      readonly manualWatch: FarmingAutomationManualWatchController;
    }
  | { readonly kind: 'failed'; readonly error: Error };

export interface ServiceWorkerFarmingAutomationRuntime {
  readonly automation: FarmingAutomation;
  readonly manualWatch: FarmingAutomationManualWatchController;
  readonly initialize: () => Promise<void>;
}

export function createServiceWorkerFarmingAutomationRuntime(
  state: ServiceWorkerState,
  dependencies: ServiceWorkerFarmingAutomationAssemblyDependencies,
): ServiceWorkerFarmingAutomationRuntime {
  let settleInitialization: ((result: InitializationResult) => void) | null = null;
  const ready = new Promise<InitializationResult>((resolve) => {
    settleInitialization = resolve;
  });
  let initialization: Promise<void> | null = null;

  const publicAutomation: FarmingAutomation = {
    async request(trigger) {
      const result = await ready;
      if (result.kind === 'failed') throw result.error;
      return result.automation.request(trigger);
    },
    async snooze(reason) {
      const result = await ready;
      if (result.kind === 'failed') throw result.error;
      return result.automation.snooze(reason);
    },
  };
  const publicManualWatch: FarmingAutomationManualWatchController = {
    async evaluate(input) {
      const result = await ready;
      if (result.kind === 'failed') throw result.error;
      return result.manualWatch.evaluate(input);
    },
    async reconcileTransport(input) {
      const result = await ready;
      if (result.kind === 'failed') throw result.error;
      return result.manualWatch.reconcileTransport(input);
    },
  };

  const initializeOnce = async (): Promise<void> => {
    try {
      const assembled = await assembleServiceWorkerFarmingAutomation(state, dependencies);
      settleInitialization?.({ kind: 'ready', ...assembled });
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new DOMException('Farming automation initialization failed', 'InvalidStateError');
      settleInitialization?.({ kind: 'failed', error: failure });
      throw failure;
    }
  };

  const initialize = (): Promise<void> => {
    if (initialization) return initialization;
    initialization = initializeOnce();
    return initialization;
  };

  return { automation: publicAutomation, manualWatch: publicManualWatch, initialize };
}
