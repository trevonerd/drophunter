import { createFarmingSession } from '../../src/background/farming-session.ts';
import type { ServiceWorkerState } from '../../src/background/runtime-state.ts';
import type { ServiceWorkerFarmingAutomationAssemblyDependencies } from '../../src/background/service-worker-farming-automation-assembly.ts';
import { saveState, saveTimingState } from '../../src/background/state-persistence.ts';
import { toSlug } from '../../src/shared/utils.ts';
import { createFarmingSessionAdapters } from '../fixtures/queue-management.ts';

export function createQueuedFarmingSession(
  state: ServiceWorkerState,
  { browserEvents, twitchGateway }: ServiceWorkerFarmingAutomationAssemblyDependencies,
) {
  return createFarmingSession(
    state,
    createFarmingSessionAdapters({
      watchTransport: browserEvents.watchTransport,
      ensureTwitchSession: twitchGateway.ensureTwitchSession,
      fetchDropsSnapshotFromApi: async (options) => {
        await twitchGateway.ensureTwitchSession();
        return twitchGateway.fetchDropsSnapshot(options);
      },
      fetchInventorySnapshotFromApi: twitchGateway.fetchInventorySnapshot,
      fetchDirectoryStreamersFromApi: twitchGateway.fetchDirectoryStreamers,
      fetchStreamContext: twitchGateway.fetchStreamContext,
      probeStreamInfo: twitchGateway.probeStreamInfo,
      resolveCategorySlug: async (game) => game.categorySlug || toSlug(game.name),
      saveState,
      saveTimingState,
    }),
  );
}
