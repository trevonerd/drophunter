import { afterEach, expect, test } from 'bun:test';
import { pauseManagedWatch } from '../src/background/managed-watch-marker.ts';
import { isVideoPlaybackAdvancing, observePlaybackAdvance } from '../src/content/playback.ts';
import { prepareStreamPlayback } from '../src/content/stream-playback.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

const url = 'https://www.twitch.tv/owned_channel';
const ownership = {
  kind: 'managed-tab' as const,
  tabId: 20,
  ownershipToken: 'owned-token',
  expectedChannel: 'owned_channel',
};
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let teardown: (() => void) | undefined;
function installGlobal(name: string, value: unknown) {
  if (!originalGlobals.has(name))
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => {
  teardown?.();
  teardown = undefined;
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originalGlobals.clear();
});

function player(controlState: 'playing' | 'paused' | 'unknown' | 'stale' | 'disabled' = 'playing') {
  const mocks = setupChromeMocks();
  teardown = mocks.teardown;
  const dataset: Record<string, string> = { drophunterKeepalive: '1' };
  const storage = new Map([
    [
      '__drophunter_managed_watch_v1',
      JSON.stringify({ version: 1, ownershipToken: ownership.ownershipToken, expectedUrl: url }),
    ],
  ]);
  let intentPlaying = controlState === 'playing';
  let clicks = 0;
  let nativePlays = 0;
  const video = {
    paused: false,
    muted: true,
    ended: false,
    readyState: 3,
    currentTime: 0,
    isConnected: true,
    async play() {
      nativePlays++;
      this.paused = false;
    },
    pause() {
      this.paused = true;
      queueMicrotask(() => {
        if (intentPlaying) this.paused = false;
      });
    },
  };
  const control = {
    isConnected: controlState !== 'stale',
    disabled: controlState === 'disabled',
    state: controlState === 'stale' || controlState === 'disabled' ? 'playing' : controlState,
    click() {
      clicks++;
      if (this.state === 'playing') {
        this.state = 'paused';
        intentPlaying = false;
      } else {
        this.state = 'playing';
        intentPlaying = true;
        video.paused = false;
      }
    },
  };
  installGlobal('location', { href: url });
  installGlobal('window', { location: { href: url } });
  installGlobal('navigator', { userActivation: { hasBeenActive: true } });
  installGlobal('__DROPHUNTER_DEBUG_LOGS__', false);
  installGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null });
  installGlobal('document', {
    documentElement: { dataset },
    querySelector: (selector: string) => {
      if (selector === 'video') return video;
      if (
        selector ===
        `button[data-a-target="player-play-pause-button"][data-a-player-state="${control.state}"]`
      )
        return control;
      return null;
    },
    querySelectorAll: (selector: string) => (selector === 'video' ? [video] : []),
  });
  mocks.chrome.scripting.executeScript = async (options) => [
    { frameId: 0, result: Reflect.apply(options.func, undefined, options.args ?? []) },
  ];
  return {
    video,
    control,
    dataset,
    storage,
    get clicks() {
      return clicks;
    },
    get nativePlays() {
      return nativePlays;
    },
  };
}

test.each(['playing', 'paused', 'unknown', 'stale', 'disabled'] as const)(
  'owned suspension clears keepalive and uses only the live playing Twitch control: %s',
  async (state) => {
    const page = player(state);
    await pauseManagedWatch(ownership);
    await Promise.resolve();
    expect(page.dataset.drophunterKeepalive).toBeUndefined();
    expect(page.dataset.drophunterPlaybackSuspended).toBe(url);
    expect(page.clicks).toBe(state === 'playing' ? 1 : 0);
    expect(page.video.paused).toBe(true);
    if (state === 'playing') expect(page.control.state).toBe('paused');
  },
);

test('unproven ownership cannot change keepalive or the Twitch player intent', async () => {
  const page = player();
  await pauseManagedWatch({ ...ownership, ownershipToken: 'obsolete-token' });
  expect(page.dataset.drophunterKeepalive).toBe('1');
  expect(page.dataset.drophunterPlaybackSuspended).toBeUndefined();
  expect(page.clicks).toBe(0);
  expect(page.video.paused).toBe(false);
});

test('a replacement source must advance before its reused native video is ready', async () => {
  const page = player();
  page.video.currentTime = 70;
  expect(isVideoPlaybackAdvancing(page.video, 1_000)).toBe(false);
  page.video.currentTime = 71;
  expect(isVideoPlaybackAdvancing(page.video, 1_100)).toBe(true);
  page.video.currentTime = 0;
  expect(isVideoPlaybackAdvancing(page.video, 1_200)).toBe(false);
  expect(isVideoPlaybackAdvancing(page.video, 1_300)).toBe(false);
  expect(
    await observePlaybackAdvance(page.video, async () => {
      page.video.currentTime += 0.25;
    }),
  ).toBe(true);
});

test.each([
  { readyState: 1, errorName: 'AbortError', requiresGesture: false },
  { readyState: 2, errorName: 'AbortError', requiresGesture: true },
  { readyState: 1, errorName: 'NotAllowedError', requiresGesture: true },
])('autoplay classification respects native loading evidence: %j', async (evidence) => {
  const page = player('paused');
  page.video.paused = true;
  page.video.readyState = evidence.readyState;
  page.control.click = () => {
    page.control.state = 'playing';
  };
  page.video.play = async () => {
    throw new DOMException('The play() request was interrupted by a call to pause().', evidence.errorName);
  };
  installGlobal('navigator', { userActivation: { hasBeenActive: false } });
  installGlobal('setTimeout', (callback: () => void, milliseconds: number) => {
    if (milliseconds === 250) callback();
    return 1;
  });

  const result = await prepareStreamPlayback();

  expect(result.isPlaybackReady).toBe(false);
  expect(result.userInteractionRequired).toBe(evidence.requiresGesture);
  expect(result).toMatchObject({ playbackPending: !evidence.requiresGesture });
});

test('Stop during site-control observation prevents a late native playback retry', async () => {
  const page = player('paused');
  page.video.paused = true;
  let releaseObservation: (() => void) | undefined;
  let observationHeld = false;
  installGlobal('setTimeout', (callback: () => void, milliseconds: number) => {
    if (milliseconds === 250 && !observationHeld) {
      observationHeld = true;
      releaseObservation = callback;
    } else if (milliseconds === 250) callback();
    return 1;
  });
  const preparing = prepareStreamPlayback();
  expect(page.clicks).toBe(1);
  await pauseManagedWatch(ownership);
  releaseObservation?.();
  const result = await preparing;

  expect(page.nativePlays).toBe(0);
  expect(page.dataset.drophunterKeepalive).toBeUndefined();
  expect(page.control.state).toBe('paused');
  expect(page.video.paused).toBe(true);
  expect(result.isPlaybackReady).toBe(false);
  expect(result).toMatchObject({ playbackPending: false });
});

test('Stop during a pending native play prevents its second attempt after interruption', async () => {
  const page = player('unknown');
  page.video.paused = true;
  const interrupted = Promise.withResolvers<void>();
  const nativePlay = page.video.play.bind(page.video);
  page.video.play = async () => {
    await nativePlay();
    await interrupted.promise;
    throw new DOMException('The play() request was interrupted by a call to pause().', 'AbortError');
  };
  installGlobal('setTimeout', (callback: () => void, milliseconds: number) => {
    if (milliseconds === 250) callback();
    return 1;
  });
  const preparing = prepareStreamPlayback();
  expect(page.nativePlays).toBe(1);
  await pauseManagedWatch(ownership);
  interrupted.resolve();
  const result = await preparing;

  expect(page.nativePlays).toBe(1);
  expect(page.video.paused).toBe(true);
  expect(result.isPlaybackReady).toBe(false);
  expect(result).toMatchObject({ playbackPending: false });
});

test('a new Prepare after Stop authorizes the same player without reviving its older preparation', async () => {
  const page = player('paused');
  page.video.paused = true;
  let releaseOldObservation: (() => void) | undefined;
  let observationHeld = false;
  installGlobal('setTimeout', (callback: () => void, milliseconds: number) => {
    if (milliseconds === 250 && !observationHeld) {
      observationHeld = true;
      releaseOldObservation = callback;
    } else if (milliseconds === 250) {
      if (!page.video.paused) page.video.currentTime += 0.25;
      callback();
    }
    return 1;
  });
  const olderPreparation = prepareStreamPlayback();
  await pauseManagedWatch(ownership);
  expect(page.dataset.drophunterKeepalive).toBeUndefined();
  const newerResult = await prepareStreamPlayback();
  expect(newerResult.isPlaybackReady).toBe(true);
  releaseOldObservation?.();
  const olderResult = await olderPreparation;

  expect(olderResult.isPlaybackReady).toBe(false);
  expect(olderResult).toMatchObject({ playbackPending: false });
  expect(page.nativePlays).toBe(0);
  expect(page.clicks).toBe(3);
  expect(page.dataset.drophunterKeepalive).toBe('1');
  expect(page.dataset.drophunterPlaybackSuspended).toBeUndefined();
  expect(page.video.paused).toBe(false);
  expect(page.control.state).toBe('playing');
});
