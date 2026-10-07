import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState, type ServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import type { WatchTransportMode } from '../src/types/index.ts';

function watchTransportMode(state: ServiceWorkerState): WatchTransportMode {
  return state.appState.watchTransportMode;
}

describe('watch transport restoration', () => {
  test('retains a persisted managed fallback tab when the preference is tabless', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      categorySlug: 'game',
    };
    state.appState.activeStreamer = {
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    };
    state.appState.watchTransportPreference = 'tabless';
    state.appState.watchTransportMode = 'managed-tab';
    state.appState.tabId = 7;
    let opens = 0;
    let closes = 0;
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true, progress: 1 }),
      managedTab: {
        open: async () => {
          opens += 1;
          return { owner: 'drophunter', tabId: 8 };
        },
        probe: async () => ({ accepted: true }),
        close: async (session) => {
          expect(session.tabId).toBe(7);
          closes += 1;
        },
      },
      persist: async () => {},
      broadcast: () => {},
    });

    const restored = await coordinator.restore({
      kind: 'managed-tab',
      tabId: 7,
      ownershipToken: 'legacy-fallback',
      expectedChannel: 'channel-1',
    });

    expect(restored).toBe(true);
    expect(closes).toBe(0);
    expect(opens).toBe(0);
    expect(state.appState.tabId).toBeNull();
    expect(watchTransportMode(state)).toBe('tabless');
    expect(coordinator.currentOwnership()).toEqual({
      kind: 'tabless',
      targetKey: 'campaign:campaign-1',
    });
  });

  test('publishes restored tabless ownership after a persisted fallback', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      categorySlug: 'game',
    };
    state.appState.activeStreamer = {
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    };
    state.appState.watchTransportPreference = 'tabless';
    state.appState.watchTransportMode = 'managed-tab';
    state.appState.watchHealth = {
      mode: 'managed-tab',
      isHealthy: true,
      status: 'healthy',
      reason: 'started',
      consecutiveFailures: 0,
      consecutiveStalls: 0,
      progress: 1,
      shouldFallback: false,
      checkedAt: 1,
    };
    let persists = 0;
    let broadcasts = 0;
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true, progress: 1 }),
      managedTab: {
        open: async () => null,
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {
        persists += 1;
      },
      broadcast: () => {
        broadcasts += 1;
      },
    });

    const restored = await coordinator.restore({ kind: 'tabless', targetKey: 'campaign:campaign-1' });

    expect(restored).toBe(true);
    expect(watchTransportMode(state)).toBe('tabless');
    expect(persists).toBe(1);
    expect(broadcasts).toBe(1);
  });
});
