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
      open: async () => {
        opens += 1;
        return opens === 1 ? { owner: 'drophunter', tabId: 17 } : null;
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
  const health = await coordinator.start({ ...firstStreamer, name: 'channel-2' });
  await coordinator.tick();

  // Then
  expect(health).toMatchObject({ status: 'healthy', reason: 'started' });
  expect(closes).toBe(0);
  expect(probedTabIds).toEqual([17]);
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

test('does not publish a fallback candidate after its operation is cancelled', async () => {
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
  const opened = createDeferred<null>();
  const opening = createDeferred<void>();
  let heartbeatCount = 0;
  let clock = 0;
  let current = true;
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
      open: () => {
        opening.resolve();
        return opened.promise;
      },
      probe: async () => ({ accepted: true }),
      close: async () => {},
    },
    persist: async () => {},
    broadcast: () => {},
  });
  await coordinator.start(firstStreamer);
  await coordinator.setPreference('managed-tab');
  for (let attempt = 0; attempt < 9; attempt += 1) {
    clock += 1_000;
    await coordinator.tick();
  }
  const healthBeforeFallback = state.appState.watchHealth;

  // When
  clock += 1_000;
  const fallback = coordinator.tick(() => current);
  await opening.promise;
  current = false;
  opened.resolve(null);
  await fallback;

  // Then
  expect(state.appState.watchHealth).toBe(healthBeforeFallback);
});
