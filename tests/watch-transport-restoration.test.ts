import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';

describe('watch transport restoration', () => {
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
    state.appState.watchFallbackReason = 'heartbeat-failed';
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
    expect(state.appState.watchTransportMode).toBe('tabless');
    expect(state.appState.watchFallbackReason).toBeNull();
    expect(persists).toBe(1);
    expect(broadcasts).toBe(1);
  });
});
