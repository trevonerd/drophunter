import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { reconcileManagedWatchesBeforeCreate } from '../src/background/managed-watch-preflight.ts';
import { rememberManagedWatch } from '../src/background/managed-watch-registry.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const url = 'https://www.twitch.tv/ml7support';

test('a dead historical ID cannot block the unique proved watch remapped to that ID', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    await rememberManagedWatch(20, 'dead-token', 'https://www.twitch.tv/dead_channel');
    const live = tabs.add(url, 70);
    expect(await managedWatchMarker.write(live.id, 'live-token', url)).toBe(true);
    tabs.pages.delete(live.id);
    live.id = 20;
    tabs.pages.set(live.id, live);
    const host = createChromeFarmingAutomationHost();

    expect(await reconcileManagedWatchesBeforeCreate(host, null, () => true)).toEqual({
      kind: 'reuse',
      ownership: {
        kind: 'managed-tab',
        tabId: live.id,
        ownershipToken: 'live-token',
        expectedChannel: 'ml7support',
      },
    });
    expect(
      (await host.tabs.create({ url: 'https://www.twitch.tv/next_channel', active: false, muted: true }))?.id,
    ).toBe(live.id);
    expect(live.url).toBe('https://www.twitch.tv/next_channel');
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('unavailable ownership still blocks creation when no proved watch can be reused', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const live = tabs.add(url);
    expect(await managedWatchMarker.write(live.id, 'live-token', url)).toBe(true);
    mocks.chrome.scripting.executeScript = async () => {
      throw new Error('Unavailable');
    };
    const host = createChromeFarmingAutomationHost();

    expect(await reconcileManagedWatchesBeforeCreate(host, null, () => true)).toEqual({ kind: 'blocked' });
    expect(
      await host.tabs.create(
        { url: 'https://www.twitch.tv/next_channel', active: false, muted: true },
        () => true,
        true,
      ),
    ).toBeNull();
    expect(live.url).toBe(url);
    expect(tabs.created).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('an unavailable historical token does not prevent reusing the unique proved settled watch', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const historical = tabs.add('https://www.twitch.tv/dead_channel', 20);
    await rememberManagedWatch(historical.id, 'dead-token', historical.url);
    const live = tabs.add(url, 70);
    expect(await managedWatchMarker.write(live.id, 'live-token', url)).toBe(true);
    const executeScript = mocks.chrome.scripting.executeScript;
    mocks.chrome.scripting.executeScript = async (properties) => {
      if (properties.target.tabId === historical.id) throw new Error('Unavailable historical page');
      return executeScript(properties);
    };
    const host = createChromeFarmingAutomationHost();

    expect(await reconcileManagedWatchesBeforeCreate(host, null, () => true)).toMatchObject({
      kind: 'reuse',
      ownership: { tabId: live.id, ownershipToken: 'live-token' },
    });
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('multiple proved watches and a pending proved navigation remain blocked', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const first = tabs.add(url);
    const second = tabs.add('https://www.twitch.tv/second_channel');
    expect(await managedWatchMarker.write(first.id, 'first', first.url)).toBe(true);
    expect(await managedWatchMarker.write(second.id, 'second', second.url)).toBe(true);
    const host = createChromeFarmingAutomationHost();
    expect(await reconcileManagedWatchesBeforeCreate(host, null, () => true)).toEqual({ kind: 'blocked' });

    tabs.pages.delete(second.id);
    first.pendingUrl = 'https://www.twitch.tv/new_channel';
    expect(await reconcileManagedWatchesBeforeCreate(host, null, () => true)).toEqual({ kind: 'blocked' });
    expect(tabs.created).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('remapped historical IDs cannot hide a second independently proved watch', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const first = tabs.add(url, 20);
    const second = tabs.add('https://www.twitch.tv/second_channel', 70);
    expect(await managedWatchMarker.write(first.id, 'first', first.url)).toBe(true);
    expect(await managedWatchMarker.write(second.id, 'second', second.url)).toBe(true);
    tabs.pages.delete(first.id);
    tabs.pages.delete(second.id);
    first.id = 70;
    second.id = 80;
    tabs.pages.set(first.id, first);
    tabs.pages.set(second.id, second);
    const host = createChromeFarmingAutomationHost();

    expect(await reconcileManagedWatchesBeforeCreate(host, null, () => true)).toEqual({ kind: 'blocked' });
    expect(
      await host.tabs.create({ url: 'https://www.twitch.tv/next_channel', active: false, muted: true }),
    ).toBeNull();
    expect(first.url).toBe(url);
    expect(second.url).toBe('https://www.twitch.tv/second_channel');
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});
