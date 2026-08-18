import { expect, test } from 'bun:test';
import { createWatchTransportCoordinator } from '../../src/background/watch-transport-coordinator.ts';
import { createWatchTransportCoordinatorFixture } from '../fixtures/watch-transport-coordinator.ts';

export function registerWatchTransportCoordinatorRestorationCases() {
  test('rehydrates a persisted tabless session on the next service-worker tick', async () => {
    const fixture = createWatchTransportCoordinatorFixture();
    fixture.state.appState.isRunning = true;
    fixture.state.appState.activeStreamer = {
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    };
    fixture.state.appState.watchTransportMode = 'tabless';
    let heartbeats = 0;
    const coordinator = createWatchTransportCoordinator({
      state: fixture.state,
      enabled: true,
      heartbeat: async () => {
        heartbeats += 1;
        return { accepted: true, progress: heartbeats };
      },
      managedTab: {
        open: async () => {
          fixture.counters.opens += 1;
          return { owner: 'drophunter', tabId: 9 };
        },
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    const health = await coordinator.tick();

    expect(health.mode).toBe('tabless');
    expect(heartbeats).toBe(1);
    expect(fixture.counters.opens).toBe(0);
  });

  test('rehydrates legacy managed fallback state as strict tabless without opening another tab', async () => {
    const fixture = createWatchTransportCoordinatorFixture();
    fixture.state.appState.isRunning = true;
    fixture.state.appState.activeStreamer = {
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    };
    fixture.state.appState.watchTransportMode = 'managed-tab';
    fixture.state.appState.watchFallbackReason = 'heartbeat-failed';
    fixture.state.appState.tabId = 7;
    let opens = 0;
    const coordinator = createWatchTransportCoordinator({
      state: fixture.state,
      enabled: true,
      heartbeat: async () => ({ accepted: true, progress: 1 }),
      managedTab: {
        open: async () => {
          opens += 1;
          return { owner: 'drophunter', tabId: 9 };
        },
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    const health = await coordinator.tick();

    expect(health.mode).toBe('tabless');
    expect(opens).toBe(0);
    expect(fixture.state.appState.tabId).toBeNull();
    expect(fixture.state.appState.watchTransportMode).toBe('tabless');
    expect(fixture.state.appState.watchFallbackReason).toBeNull();
  });
}
