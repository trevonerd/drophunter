import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { reconcileManagedWatchesOnStartup } from '../src/background/managed-watch-startup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { migrateExtensionStorage, STORAGE_SCHEMA_VERSION } from '../src/background/storage-migrations.ts';
import { releaseManagedTabOwnership } from '../src/background/tab-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const url = 'https://www.twitch.tv/owned_channel';
const ownership = {
  kind: 'managed-tab' as const,
  tabId: 20,
  ownershipToken: 'test-unique-token',
  expectedChannel: 'owned_channel',
};

test('real injected marker refuses wrong page, malformed marker, wrong token and ambiguous copies', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const page = tabs.add('about:blank');
    expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(false);
    page.url = url;
    expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(true);
    expect(await managedWatchMarker.locate('other-token', url)).toBeNull();
    const duplicate = tabs.add(url);
    duplicate.storage = new Map(page.storage);
    expect(await managedWatchMarker.locate(ownership.ownershipToken, url)).toBeNull();
    duplicate.storage.clear();
    expect((await managedWatchMarker.locate(ownership.ownershipToken, url))?.id).toBe(page.id);
    page.storage.set('__drophunter_managed_watch_v1', '{bad json');
    expect(await managedWatchMarker.locate(ownership.ownershipToken, url)).toBeNull();
  } finally {
    mocks.teardown();
  }
});

test.each([
  false,
  true,
])('extension update releases durable owned tab with cleared extension session and remapped ID=%s', async (remap) => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const owned = tabs.add(url);
    const user = tabs.add(url);
    expect(await managedWatchMarker.write(owned.id, ownership.ownershipToken, url)).toBe(true);
    if (remap) {
      tabs.pages.delete(owned.id);
      owned.id = 70;
      tabs.pages.set(70, owned);
    }
    mocks.storage.session._store.clear();
    await mocks.storage.local.set({
      storageSchemaVersion: STORAGE_SCHEMA_VERSION,
      lastInitializedExtensionVersion: '4.0.0-beta.22',
      appState: { isRunning: true, tabId: 20, queue: [{ id: 'game', name: 'Game', imageUrl: '' }] },
    });
    await migrateExtensionStorage('4.0.0-beta.23');
    expect(tabs.removed).toEqual([owned.id]);
    expect(tabs.pages.has(user.id)).toBe(true);
    expect(await listManagedWatches()).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test.each([
  'manual',
  'automatic',
  'stale-session-proof',
] as const)('same-version browser restart adopts unique remapped %s watch before acquisition', async (origin) => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const owned = tabs.add(url);
    expect(await managedWatchMarker.write(owned.id, ownership.ownershipToken, url)).toBe(true);
    tabs.pages.delete(owned.id);
    owned.id = 71;
    tabs.pages.set(71, owned);
    mocks.storage.session._store.clear();
    if (origin === 'stale-session-proof')
      await mocks.storage.session.set({
        'farmingAutomationOwnedWatch:test-unique-token': { version: 1, expectedUrl: url },
      });
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    state.appState.activeStreamer = {
      id: 'owned_channel',
      name: 'owned_channel',
      displayName: 'Owned',
      isLive: true,
    };
    state.appState.tabId = 20;
    const restored = await reconcileManagedWatchesOnStartup(state, origin === 'automatic' ? ownership : null);
    expect(restored).toEqual({ ...ownership, tabId: 71 });
    expect(state.appState.tabId).toBe(71);
    expect(tabs.removed).toEqual([]);
    expect(tabs.pages.size).toBe(1);
    expect((await listManagedWatches())[0]?.tabId).toBe(71);
  } finally {
    mocks.teardown();
  }
});

test('missing marker and user navigation fail closed; sole proven tab is neutralized', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const owned = tabs.add(url);
    const host = createChromeFarmingAutomationHost();
    expect(await releaseManagedTabOwnership(ownership, host)).toEqual({ kind: 'abandoned-unproven' });
    await managedWatchMarker.write(owned.id, ownership.ownershipToken, url);
    owned.url = 'https://www.twitch.tv/user_choice';
    expect(await releaseManagedTabOwnership(ownership, host)).toEqual({ kind: 'abandoned-unproven' });
    owned.url = url;
    expect(await releaseManagedTabOwnership(ownership, host)).toEqual({
      kind: 'released',
      method: 'neutralized',
    });
    expect(owned.url).toBe('about:blank');
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('retained uncertain historical handles cannot block a new proven watch', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    for (let index = 0; index < 32; index++)
      await mocks.storage.local.set({
        [`managedWatchOwnershipV1:historical-${index}`]: {
          ...ownership,
          tabId: 100 + index,
          ownershipToken: `historical-${index}`,
        },
      });
    const page = tabs.add(url);
    expect(await managedWatchMarker.write(page.id, ownership.ownershipToken, url)).toBe(true);
    expect(await listManagedWatches()).toHaveLength(33);
    expect(await releaseManagedTabOwnership(ownership, createChromeFarmingAutomationHost())).toEqual({
      kind: 'released',
      method: 'neutralized',
    });
  } finally {
    mocks.teardown();
  }
});

test('updating with two owned tabs preserves their sole browser window', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const first = tabs.add(url);
    const second = tabs.add('https://www.twitch.tv/second_channel');
    await managedWatchMarker.write(first.id, 'first', first.url);
    await managedWatchMarker.write(second.id, 'second', second.url);
    await mocks.storage.local.set({
      storageSchemaVersion: STORAGE_SCHEMA_VERSION,
      lastInitializedExtensionVersion: 'old',
      appState: {},
    });
    await migrateExtensionStorage('new');
    expect(tabs.pages.size).toBe(1);
    expect([...tabs.pages.values()][0]?.url).toBe('about:blank');
  } finally {
    mocks.teardown();
  }
});
