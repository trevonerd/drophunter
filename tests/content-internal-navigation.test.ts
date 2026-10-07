import { afterEach, expect, test } from 'bun:test';
import {
  isVideoPlaybackAdvancing,
  observePlaybackAdvance,
  resetPlaybackObservation,
} from '../src/content/playback.ts';
import { extractStreamContext, isStreamNavigationPending } from '../src/content/stream-context.ts';
import { prepareStreamPlayback } from '../src/content/stream-playback.ts';

const originals = new Map<string, PropertyDescriptor | undefined>();
function install(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test('an observation superseded by navigation cannot qualify the replacement video', async () => {
  const video = { paused: false, ended: false, readyState: 4, currentTime: 20 };
  let current = true;
  expect(
    await observePlaybackAdvance(
      video,
      async () => {
        current = false;
        resetPlaybackObservation(video);
        video.currentTime++;
      },
      false,
      () => current,
    ),
  ).toBe(false);
  expect(isVideoPlaybackAdvancing(video)).toBe(false);
  video.currentTime++;
  expect(isVideoPlaybackAdvancing(video)).toBe(true);
});

test('old player and category cannot qualify a new route before its channel header renders', async () => {
  const storage = new Map([['__drophunter_route_target_v1', 'https://www.twitch.tv/second']]);
  let headerChannel = 'first';
  const video = { paused: false, ended: false, readyState: 4, currentTime: 20 };
  isVideoPlaybackAdvancing(video);
  video.currentTime++;
  install('window', { location: { href: 'https://www.twitch.tv/second' } });
  install('navigator', {});
  install('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
  });
  install('document', {
    title: 'first - Twitch',
    body: { querySelector: () => null, querySelectorAll: () => [] },
    querySelector: (selector: string) =>
      selector === 'main h1'
        ? { closest: () => ({ getAttribute: () => `/${headerChannel}` }) }
        : selector.includes('stream-title')
          ? { textContent: 'Drops' }
          : null,
    querySelectorAll: (selector: string) => (selector === 'video' ? [video] : []),
  });
  expect(isStreamNavigationPending()).toBe(true);
  expect(await prepareStreamPlayback()).toEqual({ isPlaybackReady: false, playbackPending: true });
  expect(extractStreamContext()).toMatchObject({
    channelName: 'second',
    categorySlug: '',
    categoryLabel: '',
    isPlaybackReady: false,
    playingVideoCount: 0,
  });
  headerChannel = 'second';
  expect(isStreamNavigationPending()).toBe(false);
  expect(storage.size).toBe(0);
  expect(extractStreamContext()?.isPlaybackReady).toBe(false);
  video.currentTime++;
  expect(extractStreamContext()?.isPlaybackReady).toBe(true);
});
