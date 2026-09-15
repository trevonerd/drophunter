import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { openOwnedManagedWatch } from '../src/background/managed-watch-open.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { createFarmingSessionAdapters, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const target = { gameId: 'game', categorySlug: 'game', channelName: 'owned_channel' };
const url = 'https://www.twitch.tv/owned_channel';

test.each([
  'complete',
  'timeout',
  'stop',
  'user-navigation',
] as const)('regular managed watch handles delayed navigation: %s', async (stage) => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const state = createServiceWorkerState();
  const session = createFarmingSession(state, createFarmingSessionAdapters());
  const waiting = createDeferred<void>();
  const nativeUpdate = mocks.chrome.tabs.update;
  let playback = 0;
  mocks.chrome.tabs.update = async (id, properties) => {
    if (properties.url === url) {
      const page = tabs.pages.get(id);
      if (!page) throw new Error('No tab');
      page.pendingUrl = url;
      page.status = 'loading';
      return { ...page };
    }
    return nativeUpdate(id, properties);
  };
  const addListener = mocks.chrome.tabs.onUpdated.addListener;
  mocks.chrome.tabs.onUpdated.addListener = (listener) => {
    addListener(listener);
    waiting.resolve(undefined);
  };
  const timer = globalThis.setTimeout;
  if (stage === 'timeout')
    globalThis.setTimeout = ((callback: TimerHandler, ms?: number, ...args: unknown[]) =>
      timer(callback, ms === 15_000 ? 1 : ms, ...args)) as typeof setTimeout;
  try {
    const opening = openOwnedManagedWatch(state, target, async () => {
      playback++;
      return { isPlaybackReady: true };
    });
    await waiting.promise;
    const page = tabs.pages.get(20);
    if (!page) throw new Error('Missing created page');
    if (stage === 'stop') await session.handleStopFarming();
    if (stage === 'complete') {
      page.url = url;
      delete page.pendingUrl;
      page.status = 'complete';
    }
    if (stage === 'user-navigation') {
      page.url = 'https://www.twitch.tv/user_choice';
      delete page.pendingUrl;
    }
    if (stage !== 'timeout')
      for (const handler of [...mocks.chrome.tabs.onUpdated._handlers])
        Reflect.apply(handler, undefined, [20, { status: 'complete' }, page]);
    const result = await opening;
    expect(playback).toBe(stage === 'complete' ? 1 : 0);
    if (stage === 'complete') {
      expect(result?.tabId).toBe(20);
      expect(page.storage.size).toBe(1);
    } else {
      expect(result).toBeNull();
      expect(page.url).toBe(
        stage === 'user-navigation' ? 'https://www.twitch.tv/user_choice' : 'about:blank',
      );
      expect(page.pendingUrl).toBeUndefined();
    }
  } finally {
    globalThis.setTimeout = timer;
    mocks.teardown();
  }
});

test('native Stop after update response cancels proven pending navigation in the sole active tab', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  let current = true;
  const nativeUpdate = mocks.chrome.tabs.update;
  mocks.chrome.tabs.update = async (id, properties) => {
    if (properties.url !== url) return nativeUpdate(id, properties);
    const page = tabs.pages.get(id);
    if (!page) throw new Error('No tab');
    page.pendingUrl = url;
    page.active = true;
    current = false;
    return { ...page };
  };
  try {
    expect(
      await createChromeFarmingAutomationHost().tabs.create(
        { url, muted: true, active: false },
        () => current,
      ),
    ).toBeNull();
    expect(tabs.pages.get(20)?.url).toBe('about:blank');
    expect(tabs.pages.get(20)?.pendingUrl).toBeUndefined();
  } finally {
    mocks.teardown();
  }
});

test('ordinary unready playback retains proven tab and requests user attention', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const state = createServiceWorkerState();
    state.appState.selectedGame = createGame();
    state.appState.watchTransportPreference = 'managed-tab';
    mocks.chrome.tabs.sendMessage = async () => ({ isPlaybackReady: false, userInteractionRequired: true });
    const notifications: string[] = [];
    const events = createServiceWorkerBrowserEvents(state, {
      ensureContentScriptOnTab: async () => {},
      fetchStreamContext: async () => null,
      heartbeat: async () => ({ accepted: false }),
      notify: async (title) => {
        notifications.push(title);
      },
      notifyQueueComplete: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
    await events.watchTransport.start(createStreamer());
    expect(tabs.pages.size).toBe(1);
    expect(tabs.removed).toEqual([]);
    expect(events.watchTransport.currentOwnership()?.kind).toBe('managed-tab');
    expect(notifications).toEqual(['DropHunter needs your attention']);
  } finally {
    mocks.teardown();
  }
});
