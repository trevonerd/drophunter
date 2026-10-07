import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { WatchHealth } from '../src/background/watch-transport.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';

const healthyManaged = (checkedAt: number): WatchHealth => ({
  mode: 'managed-tab',
  isHealthy: true,
  status: 'healthy',
  reason: 'heartbeat',
  consecutiveFailures: 0,
  consecutiveStalls: 0,
  progress: 1,
  shouldFallback: false,
  checkedAt,
});

describe('watch transport handoff failures and suspension', () => {
  test.each(['unhealthy-probe', 'probe-error'] as const)(
    'Stop pauses the retained owned tab after restore fails with %s during an MV3 recycle',
    async (failure) => {
      const state = createServiceWorkerState();
      state.appState.isRunning = true;
      state.appState.selectedGame = {
        id: 'b',
        name: 'B',
        imageUrl: '',
        campaignId: 'campaign-b',
        categorySlug: 'b',
      };
      state.appState.activeStreamer = { id: 'b', name: 'b', displayName: 'B', isLive: true };
      state.appState.watchTransportMode = 'managed-tab';
      state.appState.watchTransportPreference = 'managed-tab';
      state.appState.watchHealth = healthyManaged(3);
      const ownership = {
        kind: 'managed-tab' as const,
        tabId: 22,
        ownershipToken: 'token-b',
        expectedChannel: 'b',
      };
      const pausedTabs: number[] = [];
      let opens = 0;
      const coordinator = createWatchTransportCoordinator({
        state,
        heartbeat: async () => ({ accepted: true }),
        managedTab: {
          open: async () => {
            opens++;
            return null;
          },
          probe: async () => {
            if (failure === 'probe-error') throw new Error('Content script temporarily unavailable');
            return { accepted: false, reason: 'playback-inactive' };
          },
          pause: async (session) => {
            expect(session.ownership).toEqual(ownership);
            pausedTabs.push(session.tabId);
          },
          close: async () => {},
        },
        persist: async () => {},
        broadcast: () => {},
      });

      expect(await coordinator.restore(ownership)).toBe(false);
      // Startup clears the failed watch projection; ownership still authorizes Stop to pause its player.
      state.appState.activeStreamer = null;
      state.appState.watchHealth = null;
      state.appState.tabId = null;
      state.appState.isRunning = false;
      state.appState.lastStopReason = 'user-stop';
      await coordinator.stop();

      expect(pausedTabs).toEqual([22]);
      expect(opens).toBe(0);
    },
  );

  test.each(['paused', 'stopped'] as const)(
    'restoring a %s session suspends its retained owned player without resuming farming',
    async (block) => {
      const state = createServiceWorkerState();
      state.appState.isRunning = block === 'paused';
      state.appState.isPaused = block === 'paused';
      state.appState.lastStopReason = block === 'stopped' ? 'user-stop' : null;
      const ownership = {
        kind: 'managed-tab' as const,
        tabId: 22,
        ownershipToken: 'token-b',
        expectedChannel: 'b',
      };
      const pausedTabs: number[] = [];
      let opens = 0;
      const coordinator = createWatchTransportCoordinator({
        state,
        heartbeat: async () => ({ accepted: true }),
        managedTab: {
          open: async () => {
            opens++;
            return null;
          },
          probe: async () => ({ accepted: true }),
          pause: async (session) => {
            expect(session.ownership).toEqual(ownership);
            pausedTabs.push(session.tabId);
          },
          close: async () => {},
        },
        persist: async () => {},
        broadcast: () => {},
      });

      expect(await coordinator.restore(ownership)).toBe(true);

      expect(pausedTabs).toEqual([22]);
      expect(opens).toBe(0);
      expect(coordinator.currentOwnership()).toEqual(ownership);
      expect(coordinator.currentTarget()).toBeNull();
      expect(state.appState.isRunning).toBe(block === 'paused');
      expect(state.appState.isPaused).toBe(block === 'paused');
      expect(state.appState.lastStopReason).toBe(block === 'stopped' ? 'user-stop' : null);
    },
  );

  test('Stop during a pending restore probe suspends the retained owned player', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.selectedGame = {
      id: 'b',
      name: 'B',
      imageUrl: '',
      campaignId: 'campaign-b',
      categorySlug: 'b',
    };
    state.appState.activeStreamer = { id: 'b', name: 'b', displayName: 'B', isLive: true };
    state.appState.watchTransportMode = 'managed-tab';
    state.appState.watchTransportPreference = 'managed-tab';
    state.appState.watchHealth = healthyManaged(3);
    const ownership = {
      kind: 'managed-tab' as const,
      tabId: 22,
      ownershipToken: 'token-b',
      expectedChannel: 'b',
    };
    const pausedTabs: number[] = [];
    let finishProbe: (() => void) | undefined;
    const pendingProbe = new Promise<void>((resolve) => {
      finishProbe = resolve;
    });
    let probes = 0;
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async () => null,
        probe: async () => {
          probes++;
          await pendingProbe;
          return { accepted: true, progress: 1 };
        },
        pause: async (session) => {
          expect(session.ownership).toEqual(ownership);
          pausedTabs.push(session.tabId);
        },
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    const restoring = coordinator.restore(ownership);
    expect(probes).toBe(1);
    state.appState.isRunning = false;
    state.appState.lastStopReason = 'user-stop';
    await coordinator.stop();
    finishProbe?.();
    expect(await restoring).toBe(false);

    expect(pausedTabs).toEqual([22]);
    expect(coordinator.currentTarget()).toBeNull();
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('user-stop');
  });
});
