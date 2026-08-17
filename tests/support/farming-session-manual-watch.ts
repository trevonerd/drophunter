import type { FarmingAutomationManualTabsResult } from '../../src/background/farming-automation-browser.ts';
import {
  createFarmingAutomationManualWatch,
  type FarmingAutomationManualWatchController,
} from '../../src/background/farming-automation-manual-watch.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../../src/background/farming-automation-persistence.ts';
import type { ServiceWorkerState } from '../../src/background/runtime-state.ts';

export function createFarmingSessionManualWatchFixture(
  state: ServiceWorkerState,
  observeManualTabs: () => Promise<FarmingAutomationManualTabsResult>,
): FarmingAutomationManualWatchController {
  return createFarmingAutomationManualWatch({
    persistence: createInMemoryFarmingAutomationPersistence({
      state,
      storage: createInMemoryFarmingAutomationStorage(),
      getSessionRevision: () => 'session-1',
      broadcast: () => undefined,
    }),
    observeManualTabs,
    replaceDeadline: async (at) => (at === null ? 'cleared' : 'scheduled'),
  });
}
