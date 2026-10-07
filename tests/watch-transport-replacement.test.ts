import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

const firstStreamer = {
  id: 'channel-1',
  name: 'channel-1',
  displayName: 'Channel 1',
  isLive: true,
};

test('keeps the current managed watch when its replacement cannot start', async () => {
  // Given
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
  const probedTabIds: number[] = [];
  const coordinator = createWatchTransportCoordinator({
    state,
    heartbeat: async () => ({ accepted: true }),
    managedTab: {
      open: async (target) => {
        opens += 1;
        return opens === 1
          ? {
              owner: 'drophunter',
              tabId: 17,
              ownership: {
                kind: 'managed-tab',
                tabId: 17,
                ownershipToken: 'incumbent',
                expectedChannel: target.channelName,
              },
            }
          : null;
      },
      probe: async (session) => {
        probedTabIds.push(session.tabId);
        return { accepted: true, progress: 1 };
      },
      close: async () => {
        closes += 1;
      },
    },
    persist: async () => {},
    broadcast: () => {},
  });
  await coordinator.start(firstStreamer);

  // When
  const incumbentHealth = state.appState.watchHealth;
  const result = await coordinator.start({ ...firstStreamer, name: 'channel-2' });

  // Then
  expect(result).toMatchObject({
    kind: 'failed',
    health: { status: 'failed', reason: 'managed-tab-unavailable' },
  });
  expect(state.appState.watchHealth).toBe(incumbentHealth);
  await coordinator.tick();
  expect(closes).toBe(0);
  expect(probedTabIds).toEqual([17, 17]);
  expect(state.appState.activeStreamer?.name).toBe('channel-1');
});

test('keeps hidden watching when an automatic managed fallback cannot start', async () => {
  // Given
  const state = createServiceWorkerState();
  state.appState.selectedGame = {
    id: 'game-1',
    name: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
    categorySlug: 'game',
  };
  state.appState.watchTransportPreference = 'tabless';
  let heartbeatCount = 0;
  let clock = 0;
  const coordinator = createWatchTransportCoordinator({
    state,
    now: () => clock,
    minHeartbeatIntervalMs: 1_000,
    heartbeat: async () => {
      heartbeatCount += 1;
      return heartbeatCount === 1
        ? { accepted: true, progress: 1 }
        : { accepted: false, reason: 'heartbeat-failed' };
    },
    managedTab: {
      open: async () => null,
      probe: async () => ({ accepted: true }),
      close: async () => {},
    },
    persist: async () => {},
    broadcast: () => {},
  });
  await coordinator.start(firstStreamer);
  await coordinator.setPreference('managed-tab');

  // When
  for (let attempt = 0; attempt < 10; attempt += 1) {
    clock += 1_000;
    await coordinator.tick();
  }

  // Then
  expect(coordinator.currentOwnership()).toEqual({
    kind: 'tabless',
    targetKey: 'campaign:campaign-1',
  });
  expect(state.appState.watchTransportMode).toBe('tabless');
});

test('Stop invalidates a pending tabless heartbeat without opening any managed tab', async () => {
  const state = createServiceWorkerState();
  state.appState.selectedGame = { id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1' };
  state.appState.watchTransportPreference = 'tabless';
  const entered = createDeferred<void>();
  const finished = createDeferred<{ accepted: boolean }>();
  let heartbeats = 0;
  let managedOpens = 0;
  const coordinator = createWatchTransportCoordinator({
    state,
    minHeartbeatIntervalMs: 0,
    heartbeat: async () => {
      if (++heartbeats === 1) return { accepted: true };
      entered.resolve();
      return finished.promise;
    },
    managedTab: {
      open: async () => {
        managedOpens++;
        return null;
      },
      probe: async () => ({ accepted: true }),
      close: async () => {},
    },
    persist: async () => {},
    broadcast: () => {},
  });
  await coordinator.start(firstStreamer);
  const pending = coordinator.tick();
  await entered.promise;
  await coordinator.stop();
  finished.resolve({ accepted: true });
  await pending;
  expect(coordinator.currentTarget()).toBeNull();
  expect(state.appState.watchHealth?.status).toBe('stopped');
  expect(managedOpens).toBe(0);
});
