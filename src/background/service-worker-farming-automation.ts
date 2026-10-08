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
  const initialized = async () => {
    const result = await ready;
    if (result.kind === 'failed') throw result.error;
    return result;
  };
  let initialization: Promise<void> | null = null;
  let initializedAutomation: FarmingAutomation | null = null;

  const publicAutomation: FarmingAutomation = {
    invalidate: () => initializedAutomation?.invalidate?.(),
    async request(trigger) {
      return (await initialized()).automation.request(trigger);
    },
    async suppressCampaignUntilRefresh(campaignKey) {
      return (await initialized()).automation.suppressCampaignUntilRefresh(campaignKey);
    },
  };
  const publicManualWatch: FarmingAutomationManualWatchController = {
    async evaluate(input) {
      return (await initialized()).manualWatch.evaluate(input);
    },
    async reconcileTransport(input) {
      return (await initialized()).manualWatch.reconcileTransport(input);
    },
  };

  const initializeOnce = async (): Promise<void> => {
    try {
      const assembled = await assembleServiceWorkerFarmingAutomation(state, dependencies);
      initializedAutomation = assembled.automation;
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
