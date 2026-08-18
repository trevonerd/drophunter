import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createWatchTransportCoordinator } from '../../src/background/watch-transport-coordinator.ts';

export function createWatchTransportCoordinatorFixture() {
  const state = createServiceWorkerState();
  state.appState.selectedGame = {
    id: 'game-1',
    name: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    categorySlug: 'game',
  };
  state.appState.watchTransportPreference = 'tabless';
  const counters = { opens: 0, closes: 0, persists: 0, broadcasts: 0 };
  let clock = 0;
  const coordinator = createWatchTransportCoordinator({
    state,
    enabled: true,
    now: () => clock,
    minHeartbeatIntervalMs: 1_000,
    heartbeat: async () => ({ accepted: true, progress: 1 }),
    managedTab: {
      open: async () => {
        counters.opens += 1;
        return { owner: 'drophunter', tabId: 7 };
      },
      probe: async () => ({ accepted: true, progress: 1 }),
      close: async () => {
        counters.closes += 1;
      },
    },
    persist: async () => {
      counters.persists += 1;
    },
    broadcast: () => {
      counters.broadcasts += 1;
    },
  });
  return {
    state,
    coordinator,
    counters,
    advance: () => {
      clock += 1_000;
      return clock;
    },
  };
}
