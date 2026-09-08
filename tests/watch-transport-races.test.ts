import { expect, test } from 'bun:test';
import type { ManagedTabOperations, WatchProbeResult } from '../src/background/watch-transport.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { createWatchTransportCoordinatorFixture } from './fixtures/watch-transport-coordinator.ts';

const streamer = { id: 'channel-1', name: 'channel-1', displayName: 'Channel 1', isLive: true };
const session = { owner: 'drophunter', tabId: 7 } as const;

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup(managedTab: ManagedTabOperations) {
  const { state } = createWatchTransportCoordinatorFixture();
  state.appState.watchTransportPreference = 'managed-tab';
  state.appState.isRunning = true;
  state.appState.activeStreamer = streamer;
  const coordinator = createWatchTransportCoordinator({
    state,
    heartbeat: async () => ({ accepted: true }),
    managedTab,
    persist: async () => {},
    broadcast: () => {},
  });
  return { state, coordinator };
}

test('restored transport cannot open a surviving tab or overwrite health after stop', async () => {
  const opened = deferred<typeof session>();
  const opening = deferred<void>();
  let closes = 0;
  const { state, coordinator } = setup({
    open: () => {
      opening.resolve();
      return opened.promise;
    },
    probe: async () => ({ accepted: true }),
    close: async () => {
      closes += 1;
    },
  });

  const tick = coordinator.tick();
  await opening.promise;
  await coordinator.stop();
  opened.resolve(session);
  await tick;

  expect(closes).toBe(1);
  expect(state.appState.watchHealth?.status).toBe('stopped');
});

test('late managed probe cannot overwrite stopped health', async () => {
  const probed = deferred<WatchProbeResult>();
  const { state, coordinator } = setup({
    open: async () => session,
    probe: () => probed.promise,
    close: async () => {},
  });
  await coordinator.start(streamer);

  const tick = coordinator.tick();
  await coordinator.stop();
  probed.resolve({ accepted: true, progress: 76 });
  await tick;

  expect(state.appState.watchHealth?.status).toBe('stopped');
});

test('late managed probe cannot overwrite a newer transport health', async () => {
  const probed = deferred<WatchProbeResult>();
  const { state, coordinator } = setup({
    open: async () => session,
    probe: () => probed.promise,
    close: async () => {},
  });
  await coordinator.start(streamer);
  const tick = coordinator.tick();
  state.appState.watchTransportPreference = 'tabless';
  await coordinator.start({ ...streamer, name: 'channel-2' });
  probed.resolve({ accepted: false, reason: 'playback-inactive' });
  await tick;

  expect(state.appState.watchTransportMode).toBe('tabless');
  expect(state.appState.watchHealth?.mode).toBe('tabless');
  expect(state.appState.activeStreamer?.name).toBe('channel-2');
});

test('slow stop cleanup cannot clear a newer start', async () => {
  const closed = deferred<void>();
  const { state, coordinator } = setup({
    open: async () => session,
    probe: async () => ({ accepted: true }),
    close: () => closed.promise,
  });
  await coordinator.start(streamer);

  const stop = coordinator.stop();
  await coordinator.start({ ...streamer, name: 'channel-2' });
  closed.resolve();
  await stop;

  expect(state.appState.watchHealth?.status).toBe('healthy');
  expect(state.appState.activeStreamer?.name).toBe('channel-2');
});

test('failed managed open stays recoverable on later monitoring ticks', async () => {
  const { coordinator } = setup({
    open: async () => null,
    probe: async () => ({ accepted: true }),
    close: async () => {},
  });
  const started = await coordinator.start(streamer);
  const checked = await coordinator.tick();

  for (const health of [started, checked]) {
    expect(health).toMatchObject({
      status: 'failed',
      reason: 'managed-tab-unavailable',
      shouldFallback: true,
    });
  }
});

test('invalidated monitoring tick cannot publish its late transport probe', async () => {
  const probed = deferred<WatchProbeResult>();
  let current = true;
  const { state, coordinator } = setup({
    open: async () => session,
    probe: () => probed.promise,
    close: async () => {},
  });
  await coordinator.start(streamer);
  const startedHealth = state.appState.watchHealth;
  const tick = coordinator.tick(() => current);
  current = false;
  probed.resolve({ accepted: true, progress: 76 });
  await tick;

  expect(state.appState.watchHealth).toBe(startedHealth);
});

test('invalidated restoration releases its late managed tab', async () => {
  const opened = deferred<typeof session>();
  const opening = deferred<void>();
  let current = true;
  let closes = 0;
  const { state, coordinator } = setup({
    open: () => {
      opening.resolve();
      return opened.promise;
    },
    probe: async () => ({ accepted: true }),
    close: async () => {
      closes += 1;
    },
  });
  const tick = coordinator.tick(() => current);
  await opening.promise;
  current = false;
  opened.resolve(session);
  await tick;

  expect(closes).toBe(1);
  expect(state.appState.watchHealth).toBeNull();
});

test('stop releases a managed fallback opened by an obsolete hidden heartbeat', async () => {
  const opened = deferred<typeof session>();
  const opening = deferred<void>();
  const { state, advance } = createWatchTransportCoordinatorFixture();
  let heartbeatCount = 0;
  let closes = 0;
  const coordinator = createWatchTransportCoordinator({
    state,
    now: advance,
    minHeartbeatIntervalMs: 1_000,
    heartbeat: async () => ({ accepted: ++heartbeatCount === 1 }),
    managedTab: {
      open: () => {
        opening.resolve();
        return opened.promise;
      },
      probe: async () => ({ accepted: true }),
      close: async () => {
        closes += 1;
      },
    },
    persist: async () => {},
    broadcast: () => {},
  });
  await coordinator.start(streamer);
  for (let index = 0; index < 9; index += 1) await coordinator.tick();
  const fallback = coordinator.tick();
  await opening.promise;
  await coordinator.stop();
  opened.resolve(session);
  await fallback;

  expect(closes).toBe(1);
  expect(state.appState.watchHealth?.status).toBe('stopped');
  expect(state.appState.watchFallbackReason).toBeNull();
});

test.each([
  'start',
  'restore',
] as const)('%s retains the managed tab registered by playback', async (action) => {
  const ownership = {
    kind: 'managed-tab',
    tabId: session.tabId,
    ownershipToken: 'managed-open-token',
    expectedChannel: streamer.name,
  } as const;
  const { state, coordinator } = setup({
    open: async () => {
      state.appState.tabId = session.tabId;
      return { ...session, ownership };
    },
    probe: async () => ({ accepted: true }),
    close: async () => {},
  });

  if (action === 'start') await coordinator.start(streamer);
  else await coordinator.tick();

  expect(state.appState.tabId).toBe(session.tabId);
  expect(coordinator.currentOwnership()).toEqual(ownership);
  expect(state.appState.watchHealth?.mode).toBe('managed-tab');
});
