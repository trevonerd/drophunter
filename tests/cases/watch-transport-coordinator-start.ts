import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createWatchTransportCoordinator } from '../../src/background/watch-transport-coordinator.ts';
import { createWatchTransportCoordinatorFixture } from '../fixtures/watch-transport-coordinator.ts';

export function registerWatchTransportCoordinatorStartCases() {
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

  test('projects transport state into the app state installed after coordinator creation', async () => {
    const state = createServiceWorkerState();
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true, progress: 1 }),
      managedTab: {
        open: async () => null,
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });
    state.appState = {
      ...state.appState,
      selectedGame: {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        categorySlug: 'game',
      },
      watchTransportPreference: 'tabless',
    };

    await coordinator.start({
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    });

    expect(state.appState.watchTransportMode).toBe('tabless');
    expect(state.appState.watchHealth?.status).toBe('healthy');
  });

  test('starts healthy tabless watching without opening a managed tab', async () => {
    const fixture = createWatchTransportCoordinatorFixture();

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

  test('keeps explicit managed-tab preference unchanged', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      categorySlug: 'game',
    };
    state.appState.watchTransportPreference = 'managed-tab';
    let opens = 0;
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => ({ accepted: true }),
      managedTab: {
        open: async (_target, options) => {
          expect(options).toEqual({ active: false, focus: false });
          opens += 1;
          return { owner: 'drophunter', tabId: 17 };
        },
        probe: async () => ({ accepted: true, progress: 1 }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });

    const health = await coordinator.start({
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    });

    expect(opens).toBe(1);
    expect(health.mode).toBe('managed-tab');
    expect(state.appState.watchTransportMode).toBe('managed-tab');
  });

  test('switching from managed-tab releases it and restarts tabless', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      categorySlug: 'game',
    };
    state.appState.watchTransportPreference = 'managed-tab';
    let opens = 0;
    let closes = 0;
    let heartbeats = 0;
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async () => {
        heartbeats += 1;
        return { accepted: true, progress: 1 };
      },
      managedTab: {
        open: async () => {
          opens += 1;
          return { owner: 'drophunter', tabId: 17 };
        },
        probe: async () => ({ accepted: true }),
        close: async (session) => {
          expect(session.tabId).toBe(17);
          closes += 1;
        },
      },
      persist: async () => {},
      broadcast: () => {},
    });
    const streamer = {
      id: 'channel-1',
      name: 'channel-1',
      displayName: 'Channel 1',
      isLive: true,
    };
    await coordinator.start(streamer);

    await coordinator.setPreference('tabless');
    const health = await coordinator.start(streamer);

    expect(opens).toBe(1);
    expect(closes).toBe(1);
    expect(heartbeats).toBe(1);
    expect(health.mode).toBe('tabless');
    expect(state.appState.tabId).toBeNull();
    expect(state.appState.watchFallbackReason).toBeNull();
  });

  test('uses the Twitch category id for heartbeat validation', async () => {
    const fixture = createWatchTransportCoordinatorFixture();
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
}
