import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';

function setup() {
  const state = createServiceWorkerState();
  state.appState.selectedGame = {
    id: 'game-1',
    name: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    categorySlug: 'game',
  };
  state.appState.watchTransportPreference = 'tabless';
  let opens = 0;
  let closes = 0;
  let persists = 0;
  let broadcasts = 0;
  let clock = 0;
  const coordinator = createWatchTransportCoordinator({
    state,
    enabled: true,
    now: () => clock,
    minHeartbeatIntervalMs: 1_000,
    heartbeat: async () => ({ accepted: true, progress: 1 }),
    managedTab: {
      open: async () => {
        opens += 1;
        return { owner: 'drophunter', tabId: 7 };
      },
      probe: async () => ({ accepted: true, progress: 1 }),
      close: async () => {
        closes += 1;
      },
    },
    persist: async () => {
      persists += 1;
    },
    broadcast: () => {
      broadcasts += 1;
    },
  });
  return {
    state,
    coordinator,
    counters: { opens, closes, persists, broadcasts },
    advance: () => (clock += 1_000),
  };
}

describe('watch transport coordinator', () => {
  test('persists projected health before broadcasting it', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      categorySlug: 'game',
    };
    state.appState.watchTransportPreference = 'tabless';
    const events: string[] = [];
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true, progress: 1 }),
      managedTab: {
        open: async () => null,
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {
        events.push(`persist:${state.appState.watchHealth?.status}`);
      },
      broadcast: () => {
        events.push(`broadcast:${state.appState.watchHealth?.status}`);
      },
    });

    await coordinator.start({
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    });

    expect(events).toEqual(['persist:healthy', 'broadcast:healthy']);
  });

  test('starts healthy tabless watching without opening a managed tab', async () => {
    const fixture = setup();

    const health = await fixture.coordinator.start({
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    });

    expect(health.mode).toBe('tabless');
    expect(fixture.state.appState.watchTransportMode).toBe('tabless');
    expect(fixture.state.appState.watchHealth?.status).toBe('healthy');
    expect(fixture.counters.opens).toBe(0);
  });

  test('uses the Twitch category id for heartbeat validation', async () => {
    const fixture = setup();
    fixture.state.appState.selectedGame = {
      id: 'campaign-derived-id',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      categoryId: 'twitch-category-id',
      categorySlug: 'game',
    };
    let heartbeatGameId = '';
    const coordinator = createWatchTransportCoordinator({
      state: fixture.state,
      enabled: true,
      heartbeat: async (target) => {
        heartbeatGameId = target.gameId;
        return { accepted: true, progress: 1 };
      },
      managedTab: {
        open: async () => null,
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    await coordinator.start({ id: 'channel-1', name: 'channel-1', displayName: 'Channel 1', isLive: true });

    expect(heartbeatGameId).toBe('twitch-category-id');
  });

  test('falls back to a managed tab on the tenth unhealthy heartbeat', async () => {
    const fixture = setup();
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
    expect(fixture.counters.opens).toBe(1);
    expect(fixture.state.appState.watchTransportMode).toBe('managed-tab');
    expect(fixture.state.appState.watchFallbackReason).toBe('heartbeat-failed');
  });

  test('rehydrates a persisted tabless session on the next service-worker tick', async () => {
    const fixture = setup();
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

  test('falls back when inventory progress remains stalled despite accepted heartbeats', async () => {
    const fixture = setup();
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

    expect(opens).toBe(1);
    expect(fixture.state.appState.watchFallbackReason).toBe('stalled-progress');
  });
});
