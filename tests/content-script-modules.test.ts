import { afterEach, expect, test } from 'bun:test';
import { handleRuntimeMessage } from '../src/content/content-messages.ts';
import { startContentScript } from '../src/content/content-script.ts';

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
function installGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name))
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originalGlobals.clear();
});

test('runtime stream context uses the extracted primary-category module and live playback state', () => {
  const watchedCategory = {
    textContent: 'Overwatch',
    getAttribute: () => '/directory/category/overwatch',
  };
  installGlobal('window', { location: { href: 'https://www.twitch.tv/watched_channel' } });
  installGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  installGlobal('document', {
    title: 'Drops enabled - Twitch',
    querySelector: (selector: string) =>
      selector.includes('stream-title') ? { textContent: 'Drops enabled' } : {},
    querySelectorAll: (selector: string) => {
      if (selector === 'video') return [{ paused: false, ended: false, readyState: 3 }];
      if (selector === 'a[data-a-target="stream-game-link"]') return [watchedCategory];
      return [];
    },
  });
  const responses: unknown[] = [];
  expect(
    handleRuntimeMessage({ type: 'GET_STREAM_CONTEXT' }, {}, (response) => responses.push(response)),
  ).toBe(true);
  expect(responses).toEqual([
    {
      success: true,
      context: {
        channelName: 'watched_channel',
        categorySlug: 'overwatch',
        categoryLabel: 'Overwatch',
        streamTitle: 'Drops enabled',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        videoCount: 1,
        playingVideoCount: 1,
        isPlaybackReady: true,
        pageUrl: 'https://www.twitch.tv/watched_channel',
      },
    },
  ]);
});

test('runtime dispatch rejects malformed requests and safely prepares a non-channel page', async () => {
  installGlobal('window', { location: { href: 'https://www.twitch.tv/drops/inventory' } });
  installGlobal('navigator', { userActivation: { hasBeenActive: false } });
  const responses: unknown[] = [];
  handleRuntimeMessage({ type: 'PLAY_ALERT', payload: { kind: 17 } }, {}, (value) => responses.push(value));
  handleRuntimeMessage({ type: 'GET_STREAM_CONTEXT' }, {}, (value) => responses.push(value));
  handleRuntimeMessage({ type: 'PREPARE_STREAM_PLAYBACK' }, {}, (value) => responses.push(value));
  await Promise.resolve();
  expect(responses).toEqual([
    { success: false, error: 'Invalid message payload' },
    { success: true, context: null },
    {
      success: true,
      played: false,
      clickedSurface: false,
      isPlaybackReady: false,
      gateDismissed: false,
      userInteractionRequired: false,
    },
  ]);
});

test('entrypoint starts once and teardown removes relocated handlers and scheduled callbacks', async () => {
  const listeners = new Set<unknown>();
  const pageListeners = new Set<unknown>();
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const runtime: {
    id?: string;
    onMessage: { addListener: (listener: unknown) => void; removeListener: (listener: unknown) => void };
  } = {
    id: 'test-extension',
    onMessage: {
      addListener: (listener) => {
        listeners.add(listener);
      },
      removeListener: (listener) => {
        listeners.delete(listener);
      },
    },
  };
  const browser = {
    runtime,
    storage: { local: { get: async () => ({ appState: { autoClaimChannelPointsBonus: false } }) } },
  };
  installGlobal('browser', browser);
  installGlobal('chrome', browser);
  installGlobal('window', {
    sessionStorage: { getItem: () => null },
    addEventListener: (_name: string, listener: unknown) => {
      pageListeners.add(listener);
    },
    removeEventListener: (_name: string, listener: unknown) => {
      pageListeners.delete(listener);
    },
    setInterval: (callback: () => void, delay: number) => {
      expect(delay).toBe(5000);
      intervals.set(1, callback);
      return 1;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
    setTimeout: (callback: () => void, delay: number) => {
      expect(delay).toBe(900);
      timeouts.set(2, callback);
      return 2;
    },
    clearTimeout: (id: number) => {
      timeouts.delete(id);
    },
  });
  startContentScript();
  startContentScript();
  await Promise.resolve();
  expect(listeners.size).toBe(2);
  expect(listeners.has(handleRuntimeMessage)).toBe(true);
  expect(pageListeners.size).toBe(1);
  expect(intervals.size).toBe(1);
  expect(timeouts.size).toBe(1);
  delete runtime.id;
  intervals.get(1)?.();
  expect(listeners.size).toBe(0);
  expect(pageListeners.size).toBe(0);
  expect(intervals.size).toBe(0);
  expect(timeouts.size).toBe(0);
});
