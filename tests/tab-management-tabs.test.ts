import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { openOwnedManagedWatch } from '../src/background/managed-watch-open.ts';
import { rememberManagedWatch } from '../src/background/managed-watch-registry.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  closeManagedTabIfSafe,
  createManagedTab,
  ensureManagedTab,
} from '../src/background/tab-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const url = 'https://www.twitch.tv/owned_channel';
let mocks: ChromeMocks;
let tabs: ReturnType<typeof installManagedWatchPages>;
beforeEach(() => {
  mocks = setupChromeMocks();
  tabs = installManagedWatchPages(mocks);
});
afterEach(() => mocks.teardown());

test('only an explicit initial start can create the first managed tab', async () => {
  expect(await createManagedTab(url, false)).toBeNull();
  expect(tabs.created).toEqual([]);
  expect((await createManagedTab(url, false, true))?.url).toBe(url);
  expect(tabs.created).toHaveLength(1);
});

test('foreground opening recovers a registered tab even when appState lost its ID', async () => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  expect(await ensureManagedTab(null, 'https://www.twitch.tv/next_channel', true)).toBe(page.id);
  expect(page.active).toBe(true);
  expect(page.url).toBe('https://www.twitch.tv/next_channel');
  expect(await ensureManagedTab(null, 'https://www.twitch.tv/next_channel', true)).toBe(page.id);
  expect(tabs.updated.filter((item) => item.properties.url)).toHaveLength(1);
  expect(tabs.created).toEqual([]);
  expect(tabs.removed).toEqual([]);
});

test('same-channel acquisition and rollback never reload the page', async () => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  const acquired = await createChromeFarmingAutomationHost().tabs.create({ url, active: false, muted: true });
  expect(acquired?.id).toBe(page.id);
  await acquired?.restorePrevious?.();
  expect(tabs.updated).toEqual([]);
  expect(tabs.created).toEqual([]);
  expect(tabs.removed).toEqual([]);
});

test.each([
  'query',
  'get',
  'marker',
  'loading',
  'pending',
  'wrong-page',
  'user-blank-page',
  'duplicate',
] as const)('uncertain ownership cannot create a replacement: %s', async (failure) => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  if (failure === 'query')
    mocks.chrome.tabs.query = async () => {
      throw new Error('Unavailable');
    };
  if (failure === 'get')
    mocks.chrome.tabs.get = async () => {
      throw new Error('Unavailable');
    };
  if (failure === 'marker')
    mocks.chrome.scripting.executeScript = async () => {
      throw new Error('Unavailable');
    };
  if (failure === 'loading') page.status = 'loading';
  if (failure === 'pending') page.pendingUrl = 'https://www.twitch.tv/next_channel';
  if (failure === 'wrong-page') page.url = 'https://example.com';
  if (failure === 'user-blank-page') {
    await mocks.storage.session.set({
      'farmingAutomationOwnedWatch:retained': { version: 1, expectedUrl: url },
    });
    page.url = 'about:blank';
  }
  if (failure === 'duplicate') tabs.add(url).storage = new Map(page.storage);
  const state = createServiceWorkerState();
  state.appState.manualQueueAuthorized = true;
  state.appState.farmingSessionOrigin = 'manual';
  expect(
    await openOwnedManagedWatch(state, { gameId: 'game', channelName: 'next_channel' }, async () => ({
      isPlaybackReady: true,
    })),
  ).toBeNull();
  expect(tabs.created).toEqual([]);
  expect(tabs.removed).toEqual([]);
  expect(tabs.updated).toEqual([]);
});

test('a confirmed absent old tab permits exactly one replacement', async () => {
  await rememberManagedWatch(70, 'closed', url);
  const acquired = await createChromeFarmingAutomationHost().tabs.create({ url, active: false, muted: true });
  expect(acquired?.id).toBe(20);
  expect(tabs.created).toEqual([20]);
  expect(tabs.removed).toEqual([]);
});

test('failed persistence after creation cannot cause a second tab on retry', async () => {
  const save = mocks.storage.local.set;
  mocks.storage.local.set = async () => {
    throw new Error('Storage temporarily unavailable');
  };
  const host = createChromeFarmingAutomationHost();
  await expect(host.tabs.create({ url, active: false, muted: true }, undefined, true)).rejects.toThrow(
    'Storage temporarily unavailable',
  );
  mocks.storage.local.set = save;
  expect((await host.tabs.create({ url, active: false, muted: true }))?.id).toBe(20);
  expect(tabs.created).toEqual([20]);
  expect(tabs.removed).toEqual([]);
});

test('two independent hosts serialize creation and reuse the same tab', async () => {
  const entered = createDeferred<void>();
  const resume = createDeferred<void>();
  const nativeCreate = mocks.chrome.tabs.create;
  mocks.chrome.tabs.create = async (properties) => {
    entered.resolve(undefined);
    await resume.promise;
    return nativeCreate(properties);
  };
  const first = createChromeFarmingAutomationHost().tabs.create(
    { url, active: false, muted: true },
    undefined,
    true,
  );
  await entered.promise;
  const second = createChromeFarmingAutomationHost().tabs.create(
    { url, active: false, muted: true },
    undefined,
    true,
  );
  resume.resolve(undefined);
  const acquired = await Promise.all([first, second]);
  expect(acquired.map((tab) => tab?.id)).toEqual([20, 20]);
  expect(tabs.created).toEqual([20]);
  expect(tabs.updated.filter((item) => item.properties.url)).toHaveLength(1);
});

test('a stale rollback cannot undo a more recent channel acquisition', async () => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  const host = createChromeFarmingAutomationHost();
  const first = await host.tabs.create({ url: 'https://www.twitch.tv/first', active: false, muted: true });
  await managedWatchMarker.write(page.id, 'first', 'https://www.twitch.tv/first');
  await host.tabs.create({ url: 'https://www.twitch.tv/second', active: false, muted: true });
  await first?.restorePrevious?.();
  expect(page.url).toBe('https://www.twitch.tv/second');
  expect(tabs.removed).toEqual([]);
});

test('foreground fallback never takes an unproven user tab', async () => {
  const page = tabs.add('https://www.twitch.tv/user_choice');
  expect(await ensureManagedTab(page.id, url, true, true)).toBeNull();
  expect(page.url).toBe('https://www.twitch.tv/user_choice');
  expect(tabs.created).toEqual([]);
});

test('Stop cleanup preserves the video even with other tabs in its window', async () => {
  const page = tabs.add(url);
  tabs.add('https://example.com');
  expect(await closeManagedTabIfSafe(page.id)).toBe(false);
  expect(page.url).toBe(url);
  expect(tabs.removed).toEqual([]);
  expect(tabs.updated).toEqual([]);
});
