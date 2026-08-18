import { expect, test } from 'bun:test';
import { createWatchTransportCoordinator } from '../../src/background/watch-transport-coordinator.ts';
import { createWatchTransportCoordinatorFixture } from '../fixtures/watch-transport-coordinator.ts';

export function registerWatchTransportCoordinatorFailureCases() {
  test('keeps strict tabless mode after ten unhealthy heartbeats', async () => {
    const fixture = createWatchTransportCoordinatorFixture();
    let attempts = 0;
    const coordinator = createWatchTransportCoordinator({
      state: fixture.state,
      enabled: true,
      now: () => attempts * 1_000,
      minHeartbeatIntervalMs: 1_000,
      heartbeat: async () => {
        attempts += 1;
        return { accepted: false, reason: 'heartbeat-failed' };
      },
      managedTab: {
        open: async (_target, options) => {
          expect(options).toEqual({ active: false, focus: false });
          fixture.counters.opens += 1;
          return { owner: 'drophunter', tabId: 8 };
        },
        probe: async () => ({ accepted: true }),
        close: async () => {
          fixture.counters.closes += 1;
        },
      },
      persist: async () => {
        fixture.counters.persists += 1;
      },
      broadcast: () => {
        fixture.counters.broadcasts += 1;
      },
    });

    await coordinator.start({ id: 'channel-1', name: 'channel-1', displayName: 'Channel 1', isLive: true });
    for (let index = 0; index < 9; index += 1) {
      await coordinator.tick();
    }

    expect(attempts).toBe(10);
    expect(fixture.counters.opens).toBe(0);
    expect(fixture.state.appState.watchTransportMode).toBe('tabless');
    expect(fixture.state.appState.watchHealth?.shouldFallback).toBe(true);
    expect(fixture.state.appState.watchFallbackReason).toBeNull();
  });
}

export function registerWatchTransportCoordinatorStallCases() {
  test('keeps strict tabless mode when accepted heartbeats remain stalled', async () => {
    const fixture = createWatchTransportCoordinatorFixture();
    let opens = 0;
    const coordinator = createWatchTransportCoordinator({
      state: fixture.state,
      enabled: true,
      minHeartbeatIntervalMs: 1_000,
      now: (() => {
        let clock = 0;
        return () => (clock += 1_000);
      })(),
      heartbeat: async () => ({ accepted: true, progress: 5 }),
      managedTab: {
        open: async (_target, options) => {
          expect(options).toEqual({ active: false, focus: false });
          opens += 1;
          return { owner: 'drophunter', tabId: 10 };
        },
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    await coordinator.start({ id: 'channel-1', name: 'channel-1', displayName: 'Channel 1', isLive: true });
    for (let index = 0; index < 9; index += 1) {
      await coordinator.tick();
    }

    expect(opens).toBe(0);

    await coordinator.tick();

    expect(opens).toBe(0);
    expect(fixture.state.appState.watchTransportMode).toBe('tabless');
    expect(fixture.state.appState.watchHealth?.shouldFallback).toBe(true);
    expect(fixture.state.appState.watchFallbackReason).toBeNull();
  });
}
