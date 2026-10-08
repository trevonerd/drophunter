import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { openOwnedManagedWatch } from '../src/background/managed-watch-open.ts';
import { rememberManagedWatch } from '../src/background/managed-watch-registry.ts';
import { createPlaybackOrchestrator } from '../src/background/playback-orchestrator.ts';
import { createPlaybackTransport } from '../src/background/playback-transport.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { ensureManagedTab } from '../src/background/tab-management.ts';
import { createFarmingSessionAdapters, createStreamer } from './fixtures/queue-management.ts';
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
  expect(await ensureManagedTab(null, url, false)).toBeNull();
  expect(tabs.created).toEqual([]);
  const tabId = await ensureManagedTab(null, url, false, true);
  expect(tabId === null ? undefined : tabs.pages.get(tabId)?.url).toBe(url);
  expect(tabs.created).toHaveLength(1);
});

test('foreground opening recovers a registered tab even when appState lost its ID', async () => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  expect(await ensureManagedTab(null, 'https://www.twitch.tv/next_channel', true)).toBe(page.id);
  expect(page.active).toBe(true);
  expect(page.url).toBe('https://www.twitch.tv/next_channel');
  expect(await ensureManagedTab(null, 'https://www.twitch.tv/next_channel', true)).toBe(page.id);
  expect(tabs.navigated).toHaveLength(1);
  expect(tabs.updated.some((item) => item.properties.url)).toBe(false);
  expect(tabs.created).toEqual([]);
  expect(tabs.removed).toEqual([]);
});

test('same-channel acquisition and rollback never reload the page', async () => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  const acquired = await createChromeFarmingAutomationHost().managedWatchOwnership.acquire('owned_channel');
  expect(acquired?.ownership.tabId).toBe(page.id);
  await acquired?.discard();
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
  const acquired = await createChromeFarmingAutomationHost().managedWatchOwnership.acquire('owned_channel');
  expect(acquired?.ownership.tabId).toBe(20);
  expect(tabs.created).toEqual([20]);
  expect(tabs.removed).toEqual([]);
});

test('failed persistence after creation cannot cause a second tab on retry', async () => {
  const save = mocks.storage.local.set;
  mocks.storage.local.set = async () => {
    throw new Error('Storage temporarily unavailable');
  };
  const ownership = createChromeFarmingAutomationHost().managedWatchOwnership;
  expect(await ownership.acquire('owned_channel', { allowInitialCreation: true })).toBeNull();
  mocks.storage.local.set = save;
  expect((await ownership.acquire('owned_channel'))?.ownership.tabId).toBe(20);
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
  const first = createChromeFarmingAutomationHost().managedWatchOwnership.acquire('owned_channel', {
    allowInitialCreation: true,
  });
  await entered.promise;
  const second = createChromeFarmingAutomationHost().managedWatchOwnership.acquire('owned_channel', {
    allowInitialCreation: true,
  });
  resume.resolve(undefined);
  const acquired = await Promise.all([first, second]);
  expect(acquired.map((candidate) => candidate?.ownership.tabId)).toEqual([20, 20]);
  expect(tabs.created).toEqual([20]);
  expect(tabs.updated.filter((item) => item.properties.url)).toHaveLength(1);
});

test('a stale rollback cannot undo a more recent channel acquisition', async () => {
  const page = tabs.add(url);
  await managedWatchMarker.write(page.id, 'retained', url);
  const ownedTabs = createChromeFarmingAutomationHost().managedWatchOwnership;
  const first = await ownedTabs.acquire('first');
  expect(await first?.confirm()).toBe(true);
  const second = await ownedTabs.acquire('second');
  expect(await second?.confirm()).toBe(true);
  await first?.discard();
  expect(page.url).toBe('https://www.twitch.tv/second');
  expect(tabs.removed).toEqual([]);
});

test('foreground fallback never takes an unproven user tab', async () => {
  const page = tabs.add('https://www.twitch.tv/user_choice');
  expect(await ensureManagedTab(page.id, url, true, true)).toBeNull();
  expect(page.url).toBe('https://www.twitch.tv/user_choice');
  expect(tabs.created).toEqual([]);
});

test.each(['proof', 'creation'] as const)(
  'Stop during owned-tab %s prevents late legacy navigation or focus',
  async (boundary) => {
    const page = boundary === 'proof' ? tabs.add(url) : null;
    if (page) await managedWatchMarker.write(page.id, 'retained', url);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const nativeScript = mocks.chrome.scripting.executeScript;
    const nativeCreate = mocks.chrome.tabs.create;
    let holdProof = true;
    mocks.chrome.scripting.executeScript = async (options) => {
      if (boundary === 'proof' && holdProof) {
        holdProof = false;
        entered.resolve();
        await release.promise;
      }
      return nativeScript(options);
    };
    if (boundary === 'creation')
      mocks.chrome.tabs.create = async (properties) => {
        entered.resolve();
        await release.promise;
        return nativeCreate(properties);
      };
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    const messages: unknown[] = [];
    const orchestrator = createPlaybackOrchestrator(state, {
      transport: createPlaybackTransport({
        tabsApi: {
          get: (tabId) => mocks.chrome.tabs.get(tabId),
          update: (tabId, properties) => mocks.chrome.tabs.update(tabId, properties),
          sendMessage: async (_tabId, message) => {
            messages.push(message);
            return {};
          },
        },
        windowsApi: { update: async () => null },
        ensureContentScriptOnTab: async () => {},
        ensureManagedTab: (tabId, targetUrl, active, isCurrent) =>
          ensureManagedTab(tabId, targetUrl, active, true, isCurrent),
        waitForTabComplete: async () => {},
      }),
      shouldMuteManagedFarmingTab: () => true,
      streamerWatchUrl: (channel) => `https://www.twitch.tv/${channel}`,
    });
    const session = createFarmingSession(state, createFarmingSessionAdapters());
    const opening = orchestrator.openForegroundChannel(createStreamer({ name: 'next_channel' }));
    try {
      await entered.promise;
      await session.handleStopFarming();
      release.resolve();
      expect(await opening).toBeNull();
      if (page) expect(page.url).toBe(url);
      else {
        expect(tabs.pages.size).toBe(1);
        expect(tabs.pages.get(20)?.url).toBe('about:blank');
      }
      expect(tabs.updated).toEqual([]);
      expect(tabs.created).toEqual(boundary === 'proof' ? [] : [20]);
      expect(tabs.removed).toEqual([]);
      expect(messages).toEqual([]);
      expect(state.appState.activeStreamer).toBeNull();
    } finally {
      release.resolve();
      await opening;
    }
  },
);
