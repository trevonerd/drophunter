import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import {
  managedWatchMarker,
  pauseManagedWatch,
  serializeManagedWatchMutation,
} from '../src/background/managed-watch-marker.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const url = 'https://www.twitch.tv/owned_channel';

test('a superseded Stop cannot pause the recovered retained player after waiting for serialized mutations', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const page = tabs.add(url, 20);
  expect(await managedWatchMarker.write(page.id, 'latest-token', url)).toBe(true);
  page.playing = true;
  const state = createServiceWorkerState();
  const events = createServiceWorkerBrowserEvents(state, {
    ensureContentScriptOnTab: async () => {},
    fetchStreamContext: async () => null,
    heartbeat: async () => ({ accepted: false }),
    notify: async () => {},
    notifyQueueComplete: async () => {},
    clearQueueCompleteNotification: async () => {},
  });
  const blocked = createDeferred<void>();
  const entered = createDeferred<void>();
  const mutation = serializeManagedWatchMutation(async () => {
    entered.resolve();
    await blocked.promise;
  });
  await entered.promise;
  const stopping = events.watchTransport.stop();
  try {
    for (let tick = 0; tick < 50; tick++) await Promise.resolve();
    state.tickGeneration++;
    blocked.resolve();
    await mutation;
    await stopping;

    expect(page.playing).toBe(true);
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
    expect(state.appState.watchHealth).toBeNull();
  } finally {
    blocked.resolve();
    await stopping.catch(() => undefined);
    mocks.teardown();
  }
});

test('a pause guard is rechecked inside the serialized browser mutation', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const page = tabs.add(url, 20);
  expect(await managedWatchMarker.write(page.id, 'latest-token', url)).toBe(true);
  page.playing = true;
  const blocked = createDeferred<void>();
  const entered = createDeferred<void>();
  const mutation = serializeManagedWatchMutation(async () => {
    entered.resolve();
    await blocked.promise;
  });
  await entered.promise;
  let current = true;
  const pausing = pauseManagedWatch(
    { kind: 'managed-tab', tabId: page.id, ownershipToken: 'latest-token', expectedChannel: 'owned_channel' },
    () => current,
  );
  try {
    current = false;
    blocked.resolve();
    await mutation;
    await pausing;

    expect(page.playing).toBe(true);
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
  } finally {
    blocked.resolve();
    await pausing.catch(() => undefined);
    mocks.teardown();
  }
});

test('a superseded Stop cannot replace the registry of a newer navigation during ownership recovery', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const page = tabs.add(url, 20);
  expect(await managedWatchMarker.write(page.id, 'old-token', url)).toBe(true);
  page.playing = true;
  const state = createServiceWorkerState();
  const events = createServiceWorkerBrowserEvents(state, {
    ensureContentScriptOnTab: async () => {},
    fetchStreamContext: async () => null,
    heartbeat: async () => ({ accepted: false }),
    notify: async () => {},
    notifyQueueComplete: async () => {},
    clearQueueCompleteNotification: async () => {},
  });
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const nativeGet = mocks.chrome.storage.local.get;
  mocks.chrome.storage.local.get = async (keys) => {
    const result = await nativeGet(keys);
    if (keys === 'managedWatchOwnershipV1:old-token') {
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  const stopping = events.watchTransport.stop();
  try {
    await entered.promise;
    state.tickGeneration++;
    expect(await managedWatchMarker.write(page.id, 'new-token', url)).toBe(true);
    release.resolve();
    await stopping;

    expect(page.playing).toBe(true);
    expect(await listManagedWatches()).toEqual([
      { kind: 'managed-tab', tabId: page.id, ownershipToken: 'new-token', expectedChannel: 'owned_channel' },
    ]);
    expect(tabs.removed).toEqual([]);
  } finally {
    release.resolve();
    await stopping.catch(() => undefined);
    mocks.teardown();
  }
});

test('Stop while the browser mutation queue is occupied never navigates the newly owned blank tab', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const blocked = createDeferred<void>();
  const entered = createDeferred<void>();
  const mutation = serializeManagedWatchMutation(async () => {
    entered.resolve();
    await blocked.promise;
  });
  await entered.promise;
  let current = true;
  const opening = createChromeFarmingAutomationHost().tabs.create(
    { url, muted: true, active: false },
    () => current,
    true,
  );
  try {
    for (let tick = 0; tick < 50; tick++) await Promise.resolve();
    expect(tabs.created).toHaveLength(1);
    expect(tabs.updated).toHaveLength(0);
    current = false;
    blocked.resolve();
    await mutation;
    expect(await opening).toBeNull();
    expect(tabs.pages.get(20)?.url).toBe('about:blank');
    expect(tabs.updated).toHaveLength(0);
  } finally {
    blocked.resolve();
    await opening.catch(() => null);
    mocks.teardown();
  }
});

test('Stop before a queued reused-tab navigation leaves the previous page untouched', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const host = createChromeFarmingAutomationHost();
  const first = await host.tabs.create({ url, muted: true, active: false }, () => true, true);
  expect(first?.id).toBe(20);
  const blocked = createDeferred<void>();
  const entered = createDeferred<void>();
  const mutation = serializeManagedWatchMutation(async () => {
    entered.resolve();
    await blocked.promise;
  });
  await entered.promise;
  let current = true;
  const pending = host.tabs.create(
    { url: 'https://www.twitch.tv/next_channel', muted: true, active: false },
    () => current,
  );
  try {
    for (let tick = 0; tick < 50; tick++) await Promise.resolve();
    current = false;
    blocked.resolve();
    await mutation;
    expect(await pending).toBeNull();
    expect(tabs.pages.get(20)?.url).toBe(url);
    expect(tabs.created).toHaveLength(1);
    expect(tabs.updated).toHaveLength(1);
  } finally {
    blocked.resolve();
    await pending.catch(() => null);
    mocks.teardown();
  }
});
