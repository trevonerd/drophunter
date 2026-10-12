import { afterEach, describe, expect, test } from 'bun:test';
import {
  createHlsWatch,
  type HlsFetch,
  type HlsWatch,
  isAllowedHlsUrl,
  playlistUrls,
} from '../src/background/twitch-api/hls-watch.ts';

const CDN = 'https://video-weaver.ttvnw.net/v1/playlist';
const EDGE = 'https://video-edge.ttvnw.net/v1/segment';
const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000
${CDN}/source.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2"
${CDN}/audio.m3u8
`;

function mediaPlaylist(segments: readonly string[]): string {
  return [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:2',
    ...segments.flatMap((name) => ['#EXTINF:2.000,live', `${EDGE}/${name}.ts`]),
  ].join('\n');
}

interface Request {
  readonly url: string;
  readonly init: RequestInit;
}

function harness(options: { token?: () => { value: string; signature: string } | null } = {}) {
  let clock = 1_000_000;
  let segments = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  const routes = new Map<string, () => Response | Promise<Response>>();
  const requests: Request[] = [];
  const tokenRequests: string[] = [];
  const sustainChanges: boolean[] = [];
  const fetch: HlsFetch = async (url, init) => {
    requests.push({ url, init });
    const parsed = new URL(url);
    const route = routes.get(`${parsed.origin}${parsed.pathname}`);
    if (route) return route();
    if (url === `${CDN}/audio.m3u8`) return new Response(mediaPlaylist(segments));
    if (url.startsWith(`${EDGE}/`)) return new Response(null, { status: 200 });
    if (parsed.hostname === 'usher.ttvnw.net') return new Response(MASTER);
    throw new Error(`unexpected request ${url}`);
  };
  const watch = createHlsWatch({
    fetch,
    now: () => clock,
    fetchPlaybackToken: async (channel) => {
      tokenRequests.push(channel);
      return options.token ? options.token() : { value: '{"channel":"streamer"}', signature: 'signed' };
    },
    onSustainChange: (sustaining) => sustainChanges.push(sustaining),
  });
  watches.push(watch);
  return {
    watch,
    requests,
    routes,
    tokenRequests,
    sustainChanges,
    heads: () => requests.filter((request) => request.init.method === 'HEAD').map((request) => request.url),
    setSegments: (next: string[]) => {
      segments = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const watches: HlsWatch[] = [];
afterEach(() => {
  for (const watch of watches.splice(0)) watch.release();
});

const context = { channel: 'Streamer', broadcastId: 'broadcast-1' };

describe('HLS URL guards', () => {
  test('accepts only credential-free https URLs on the Twitch video CDN', () => {
    expect(isAllowedHlsUrl('https://usher.ttvnw.net/api/channel/hls/a.m3u8')).toBe(true);
    expect(isAllowedHlsUrl('https://ttvnw.net/a')).toBe(true);
    expect(isAllowedHlsUrl('http://usher.ttvnw.net/a')).toBe(false);
    expect(isAllowedHlsUrl('https://user:pass@usher.ttvnw.net/a')).toBe(false);
    expect(isAllowedHlsUrl('https://ttvnw.net.example.com/a')).toBe(false);
    expect(isAllowedHlsUrl('https://notttvnw.net/a')).toBe(false);
    expect(isAllowedHlsUrl('not a url')).toBe(false);
  });

  test('lists tagged variants and segments, resolving relative URIs against the CDN base', () => {
    expect(playlistUrls(MASTER, 'https://usher.ttvnw.net/api/channel/hls/a.m3u8', 'master')).toEqual([
      `${CDN}/source.m3u8`,
      `${CDN}/audio.m3u8`,
    ]);
    expect(
      playlistUrls(
        '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nseg-1.ts\n',
        `${CDN}/audio.m3u8`,
        'media',
      ),
    ).toEqual([`${CDN}/seg-1.ts`]);
  });

  test('rejects malformed or foreign playlists as a whole', () => {
    const base = `${CDN}/audio.m3u8`;
    expect(playlistUrls('#EXTINF:2,\nseg.ts', base, 'media')).toEqual([]);
    expect(playlistUrls('#EXTM3U\nseg.ts', base, 'media')).toEqual([]);
    expect(playlistUrls('#EXTM3U\n#EXTINF:2,\nseg.ts\n#EXTINF:2,', base, 'media')).toEqual([]);
    expect(playlistUrls('#EXTM3U\n#EXTINF:2,\nhttps://example.com/seg.ts', base, 'media')).toEqual([]);
    expect(playlistUrls('#EXTM3U\n#EXT-X-STREAM-INF:B=1\nvideo.ts', base, 'master')).toEqual([]);
    expect(playlistUrls('#EXTM3U\n#EXTINF:2,\nseg.ts', 'https://example.com/a.m3u8', 'media')).toEqual([]);
  });
});

describe('HLS watch', () => {
  test('requests the newest live segments of the audio-only variant with an anonymous signed playlist', async () => {
    const h = harness();

    expect(await h.watch.poll(context)).toEqual({ ok: true });

    expect(h.tokenRequests).toEqual(['streamer']);
    const usher = new URL(h.requests[0]?.url ?? '');
    expect(`${usher.origin}${usher.pathname}`).toBe('https://usher.ttvnw.net/api/channel/hls/streamer.m3u8');
    expect(usher.searchParams.get('sig')).toBe('signed');
    expect(usher.searchParams.get('token')).toBe('{"channel":"streamer"}');
    expect(usher.searchParams.get('allow_audio_only')).toBe('true');
    expect(h.requests[1]?.url).toBe(`${CDN}/audio.m3u8`);
    expect(h.heads()).toEqual(['s3', 's4', 's5', 's6', 's7', 's8'].map((name) => `${EDGE}/${name}.ts`));
    for (const { init } of h.requests) {
      expect(init).toMatchObject({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
      });
    }
    expect(h.sustainChanges).toEqual([true]);
  });

  test('requests only new segments on later polls and reuses the playlist', async () => {
    const h = harness();
    await h.watch.poll(context);
    h.requests.length = 0;

    expect(await h.watch.poll(context)).toEqual({ ok: true });
    expect(h.heads()).toEqual([]);

    h.setSegments(['s7', 's8', 's9']);
    expect(await h.watch.poll(context)).toEqual({ ok: true });
    expect(h.heads()).toEqual([`${EDGE}/s9.ts`]);
    expect(h.tokenRequests).toHaveLength(1);
    expect(h.sustainChanges).toEqual([true]);
  });

  test('starts over for a new broadcast', async () => {
    const h = harness();
    await h.watch.poll(context);
    h.requests.length = 0;

    await h.watch.poll({ ...context, broadcastId: 'broadcast-2' });

    expect(h.tokenRequests).toHaveLength(2);
    expect(h.heads()).toHaveLength(6);
  });

  test('fails and reacquires the playlist after the CDN rejects it', async () => {
    const h = harness();
    await h.watch.poll(context);
    h.routes.set(`${CDN}/audio.m3u8`, () => new Response(null, { status: 403 }));

    expect(await h.watch.poll(context)).toEqual({
      ok: false,
      message: 'Twitch HLS playlist returned HTTP 403',
    });
    expect(h.sustainChanges).toEqual([true, false]);

    h.routes.clear();
    expect(await h.watch.poll(context)).toEqual({ ok: true });
    expect(h.tokenRequests).toHaveLength(2);
  });

  test('fails when no live-edge segment could be requested', async () => {
    const h = harness();
    h.routes.set(`${EDGE}/s8.ts`, () => new Response(null, { status: 500 }));
    h.setSegments(['s8']);

    expect(await h.watch.poll(context)).toEqual({
      ok: false,
      message: 'Twitch HLS segment returned HTTP 500',
    });
  });

  test('backs off playback-token requests after failures', async () => {
    let issued = false;
    const h = harness({ token: () => (issued ? { value: 'v', signature: 's' } : null) });

    expect(await h.watch.poll(context)).toEqual({
      ok: false,
      message: 'Twitch did not return a playback playlist',
    });
    expect((await h.watch.poll(context)).ok).toBe(false);
    expect(h.tokenRequests).toHaveLength(1);

    h.advance(60_000);
    expect((await h.watch.poll(context)).ok).toBe(false);
    expect(h.tokenRequests).toHaveLength(2);
    h.advance(60_000);
    await h.watch.poll(context);
    expect(h.tokenRequests).toHaveLength(2);

    issued = true;
    h.advance(60_000);
    expect(await h.watch.poll(context)).toEqual({ ok: true });
    expect(h.tokenRequests).toHaveLength(3);
  });

  test('follows CDN redirects but never sends a signed URL off the CDN', async () => {
    const h = harness();
    h.routes.set(
      `${EDGE}/s7.ts`,
      () => new Response(null, { status: 302, headers: { location: '/v1/segment/s7b.ts' } }),
    );
    h.routes.set(
      `${EDGE}/s8.ts`,
      () => new Response(null, { status: 302, headers: { location: 'https://example.com/s8.ts?sig=x' } }),
    );
    h.setSegments(['s7', 's8']);

    expect(await h.watch.poll(context)).toEqual({ ok: true });
    expect(h.heads()).toEqual([`${EDGE}/s7.ts`, `${EDGE}/s7b.ts`, `${EDGE}/s8.ts`]);
    expect(h.requests.some((request) => request.url.includes('example.com'))).toBe(false);

    h.setSegments(['s8']);
    expect(await h.watch.poll(context)).toEqual({
      ok: false,
      message: 'Twitch HLS response came from an unexpected host',
    });
  });

  test('keeps signed URLs out of failure messages', async () => {
    const h = harness();
    h.routes.set(`${CDN}/audio.m3u8`, () => {
      throw new Error(`fetch failed for ${CDN}/audio.m3u8?sig=secret`);
    });

    expect(await h.watch.poll(context)).toEqual({ ok: false, message: 'Twitch HLS watch failed' });
  });

  test('sustains polling between ticks and stops when ticks go stale', async () => {
    const h = harness();
    await h.watch.poll(context);
    h.setSegments(['s8', 's9']);
    h.requests.length = 0;

    await h.watch.sustain();
    expect(h.heads()).toEqual([`${EDGE}/s9.ts`]);

    h.advance(150_001);
    h.requests.length = 0;
    await h.watch.sustain();
    expect(h.requests).toEqual([]);
    expect(h.sustainChanges).toEqual([true, false]);
  });

  test('release aborts the watch, stops sustaining, and the next poll starts fresh', async () => {
    const h = harness();
    await h.watch.poll(context);
    let resolveSegment: (response: Response) => void = () => undefined;
    h.routes.set(`${EDGE}/s9.ts`, () => new Promise<Response>((resolve) => (resolveSegment = resolve)));
    h.setSegments(['s9']);

    const pending = h.watch.poll(context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.watch.release();
    resolveSegment(new Response(null, { status: 200 }));

    expect(await pending).toEqual({ ok: false, message: 'Twitch HLS watch stopped' });
    expect(h.sustainChanges).toEqual([true, false]);
    h.requests.length = 0;
    await h.watch.sustain();
    expect(h.requests).toEqual([]);

    h.routes.clear();
    expect(await h.watch.poll(context)).toEqual({ ok: true });
    expect(h.tokenRequests).toHaveLength(2);
  });

  test('rejects a channel that is not a Twitch login', async () => {
    const h = harness();

    expect(await h.watch.poll({ channel: '../x', broadcastId: 'b' })).toEqual({
      ok: false,
      message: 'Twitch HLS watch has no channel login',
    });
    expect(h.requests).toEqual([]);
  });
});
