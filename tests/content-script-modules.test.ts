import { afterEach, expect, test } from 'bun:test';
import { handleRuntimeMessage } from '../src/content/content-messages.ts';
import { startContentScript } from '../src/content/content-script.ts';
import {
  isVideoPlaybackAdvancing,
  observePlaybackAdvance,
  startMutedPlayback,
} from '../src/content/playback.ts';
import { prepareStreamPlayback } from '../src/content/stream-playback.ts';

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
  const video = { paused: false, ended: false, readyState: 3, currentTime: 1 };
  isVideoPlaybackAdvancing(video);
  video.currentTime = 2;
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
      if (selector === 'video') return [video];
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

test('a resolved play request and an unpaused frozen video are not playback proof', async () => {
  const video = { paused: false, ended: false, readyState: 3, currentTime: 1 };
  let observations = 0;
  expect(
    await observePlaybackAdvance(video, async () => {
      observations++;
    }),
  ).toBe(false);
  expect(observations).toBe(8);
  expect(
    await observePlaybackAdvance(video, async () => {
      video.currentTime += 0.25;
    }),
  ).toBe(true);
});

test('an unresolved native play request has a bounded failure instead of blocking acquisition', async () => {
  installGlobal('setTimeout', (callback: () => void) => {
    callback();
    return 1;
  });
  let attempts = 0;
  const result = await startMutedPlayback({
    paused: true,
    muted: false,
    play() {
      attempts++;
      return new Promise(() => {});
    },
  });
  expect(attempts).toBe(2);
  expect(result.played).toBe(false);
  expect(result.error).toBeInstanceOf(DOMException);
  expect(result.error instanceof DOMException && result.error.name).toBe('TimeoutError');
});

test.each([
  'autoplay',
  'gesture',
  'interrupted',
  'interrupted-with-control',
  'site-pause',
  'pause-with-activation',
  'pause-without-control',
] as const)('managed playback preparation verifies %s without toggling the player', async (kind) => {
  let syntheticClicks = 0;
  let attempts = 0;
  const interruptedByPause =
    kind === 'site-pause' || kind === 'pause-with-activation' || kind === 'pause-without-control';
  const video = {
    paused: true,
    muted: false,
    ended: false,
    readyState: 3,
    currentTime: 0,
    isConnected: true,
    dispatchEvent() {
      syntheticClicks++;
      this.paused = !this.paused;
    },
    async play() {
      attempts++;
      expect(this.muted).toBe(true);
      if (kind === 'gesture') throw new DOMException('User activation required', 'NotAllowedError');
      if (interruptedByPause)
        throw new DOMException('The play() request was interrupted by a call to pause().', 'AbortError');
      if (kind === 'interrupted' || kind === 'interrupted-with-control')
        throw new DOMException('interrupted by a new load request', 'AbortError');
      this.paused = false;
    },
  };
  installGlobal('window', { location: { href: 'https://www.twitch.tv/watched_channel' } });
  installGlobal('navigator', { userActivation: { hasBeenActive: kind === 'pause-with-activation' } });
  installGlobal('__DROPHUNTER_DEBUG_LOGS__', false);
  installGlobal('document', {
    documentElement: { dataset: {} },
    querySelector: (selector: string) =>
      selector === 'video'
        ? video
        : selector.includes('player-play-pause-button') &&
            (kind === 'site-pause' || kind === 'pause-with-activation' || kind === 'interrupted-with-control')
          ? { isConnected: true, click() {} }
          : null,
    querySelectorAll: () => [],
  });
  installGlobal('setTimeout', (callback: () => void) => {
    if (!video.paused) video.currentTime += 0.25;
    callback();
    return 1;
  });
  expect(await prepareStreamPlayback()).toMatchObject({
    clickedSurface: false,
    isPlaybackReady: kind === 'autoplay',
    userInteractionRequired: kind === 'gesture' || kind === 'site-pause',
  });
  expect(syntheticClicks).toBe(0);
  expect(attempts).toBe(kind === 'autoplay' ? 1 : 2);
});

test.each([
  'supported',
  'supported-loading',
  'denied',
  'playing-control',
  'unknown-control',
  'stale-video',
  'stale-control',
  'healthy',
] as const)('managed playback uses only a valid paused Twitch Play control: %s', async (kind) => {
  let clicks = 0;
  let nativeCalls = 0;
  let authorized = false;
  let videoQueries = 0;
  let observations = 0;
  let pendingSiteStart: (() => void) | undefined;
  const supported = kind === 'supported' || kind === 'supported-loading';
  const video = {
    paused: kind !== 'healthy',
    muted: false,
    ended: false,
    readyState: 3,
    currentTime: 0,
    isConnected: true,
    async play() {
      nativeCalls++;
      expect(this.muted).toBe(true);
      if (!authorized)
        throw new DOMException('The play() request was interrupted by a call to pause().', 'AbortError');
      this.paused = false;
    },
  };
  const control = {
    isConnected: kind !== 'stale-control',
    click() {
      clicks++;
      expect(video.muted).toBe(true);
      authorized = supported;
      if (kind === 'supported-loading')
        pendingSiteStart = () => {
          void video.play().catch(() => undefined);
        };
      else void video.play().catch(() => undefined);
    },
  };
  installGlobal('window', { location: { href: 'https://www.twitch.tv/watched_channel' } });
  installGlobal('navigator', { userActivation: { hasBeenActive: false } });
  installGlobal('__DROPHUNTER_DEBUG_LOGS__', false);
  installGlobal('document', {
    documentElement: { dataset: {} },
    querySelector: (selector: string) => {
      if (selector === 'video') {
        videoQueries++;
        return kind === 'stale-video' && videoQueries > 1 ? {} : video;
      }
      return selector.includes('player-play-pause-button') &&
        kind !== 'playing-control' &&
        kind !== 'unknown-control'
        ? control
        : null;
    },
    querySelectorAll: () => [],
  });
  installGlobal('setTimeout', (callback: () => void, milliseconds: number) => {
    if (milliseconds === 250 && ++observations === 3) pendingSiteStart?.();
    if (!video.paused) video.currentTime += 0.25;
    callback();
    return 1;
  });
  const result = await prepareStreamPlayback();
  expect(result.isPlaybackReady).toBe(supported || kind === 'healthy');
  expect(result.userInteractionRequired).toBe(kind === 'denied');
  expect(clicks).toBe(supported || kind === 'denied' ? 1 : 0);
  expect(nativeCalls).toBe(kind === 'healthy' ? 0 : supported ? 1 : kind === 'denied' ? 3 : 2);
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
