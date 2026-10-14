import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createHlsWatch, type HlsFetch } from '../src/background/twitch-api/hls-watch.ts';
import { createTwitchTablessHeartbeat } from '../src/background/twitch-api/tabless-heartbeat.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';

// Real heartbeat, HLS watch and coordinator; only Twitch's HTTP responses are fixtures.

function streamInfo(channel: string): Response {
  return new Response(
    JSON.stringify({
      data: {
        user: { id: channel, stream: { id: `${channel}-broadcast`, type: 'live', game: { id: 'game' } } },
      },
    }),
  );
}

function liveMedia() {
  const requests: string[] = [];
  const sustainChanges: boolean[] = [];
  let segment = 1;
  const fetch: HlsFetch = async (url, init) => {
    requests.push(`${init.method} ${url}`);
    if (url.startsWith('https://usher.ttvnw.net/')) {
      const channel = new URL(url).pathname.split('/').at(-1)?.replace('.m3u8', '');
      return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://edge.ttvnw.net/${channel}.m3u8\n`);
    }
    if (url.endsWith('.m3u8')) {
      return new Response(`#EXTM3U\n#EXTINF:2,\n${url.replace('.m3u8', `-${segment}.ts`)}\n`);
    }
    return new Response(null, { status: 200 });
  };
  const hls = createHlsWatch({
    fetch,
    fetchPlaybackToken: async () => ({ value: 'token', signature: 'signature' }),
    onSustainChange: (sustaining) => sustainChanges.push(sustaining),
  });
  return {
    hls,
    requests,
    sustainChanges,
    nextSegment: () => {
      segment += 1;
    },
  };
}

function deferredStreamInfo(media: ReturnType<typeof liveMedia>, pendingChannel: string) {
  let resolvePending: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    resolvePending = resolve;
  });
  const heartbeat = createTwitchTablessHeartbeat({
    watch: media.hls.poll,
    fetch: async (url, init) => {
      if (!String(url).includes('gql')) return new Response('', { status: 404 });
      const channel = JSON.parse(String(init?.body)).variables.channel;
      return channel === pendingChannel ? pending : streamInfo(channel);
    },
  });
  // Mirrors the service-worker gateway: the watch is claimed before any await.
  const beat = (channel: string) =>
    heartbeat.heartbeat({ gameId: 'game', channelName: channel }, 'viewer', media.hls.claim());
  return { beat, resolve: () => resolvePending(streamInfo(pendingChannel)) };
}

describe('tabless live media lifecycle', () => {
  test('a heartbeat waiting on StreamInfo requests no media after Stop releases the watch', async () => {
    const media = liveMedia();
    const twitch = deferredStreamInfo(media, 'oldchannel');

    const stale = twitch.beat('oldchannel');
    media.hls.release();
    twitch.resolve();

    expect(await stale).toMatchObject({ accepted: false, reason: 'heartbeat-failed' });
    expect(media.requests).toEqual([]);
    expect(media.sustainChanges).toEqual([false]);
    await media.hls.sustain();
    expect(media.requests).toEqual([]);
  });

  test('a late heartbeat for the previous channel cannot replace the newer watch', async () => {
    const media = liveMedia();
    const twitch = deferredStreamInfo(media, 'oldchannel');

    const stale = twitch.beat('oldchannel');
    media.hls.release();
    expect(await twitch.beat('newchannel')).toMatchObject({ accepted: true });
    media.requests.length = 0;
    twitch.resolve();

    expect(await stale).toMatchObject({ accepted: false, reason: 'heartbeat-failed' });
    expect(media.requests).toEqual([]);
    media.nextSegment();
    await media.hls.sustain();
    expect(media.requests).toEqual([
      'GET https://edge.ttvnw.net/newchannel.m3u8',
      'HEAD https://edge.ttvnw.net/newchannel-2.ts',
    ]);
    media.hls.release();
  });

  function coordinatorWithLiveMedia() {
    const media = liveMedia();
    let releases = 0;
    const state = createServiceWorkerState();
    state.appState.selectedGame = { id: 'game', name: 'Game', imageUrl: '', campaignId: 'campaign' };
    state.appState.watchTransportPreference = 'tabless';
    const coordinator = createWatchTransportCoordinator({
      state,
      heartbeat: async (target) => {
        const watched = await media.hls.claim()({ channel: target.channelName, broadcastId: 'broadcast' });
        return { accepted: watched.ok };
      },
      releaseTablessWatch: () => {
        releases += 1;
        media.hls.release();
      },
      managedTab: {
        open: async () => ({
          owner: 'drophunter',
          tabId: 1,
          ownership: { kind: 'managed-tab', tabId: 1, ownershipToken: 'token', expectedChannel: 'streamer' },
        }),
        probe: async () => ({ accepted: true }),
        close: async () => {},
      },
      persist: async () => {},
      broadcast: () => {},
    });
    return { media, state, coordinator, releases: () => releases };
  }

  const streamer = (name: string) => ({ id: name, name, displayName: name, isLive: true });

  test('switching from tabless to a managed tab ends live media requests', async () => {
    const { media, state, coordinator, releases } = coordinatorWithLiveMedia();
    expect(await coordinator.start(streamer('streamer'))).toMatchObject({ kind: 'started' });

    await coordinator.setPreference('managed-tab');
    expect(await coordinator.start(streamer('streamer'))).toMatchObject({ kind: 'started' });

    expect(state.appState.watchTransportMode).toBe('managed-tab');
    expect(releases()).toBe(1);
    expect(media.sustainChanges.at(-1)).toBe(false);
    media.requests.length = 0;
    media.nextSegment();
    await media.hls.sustain();
    expect(media.requests).toEqual([]);
    await coordinator.stop();
  });

  test('adopting a managed tab from automation ends live media requests', async () => {
    const { media, coordinator, releases } = coordinatorWithLiveMedia();
    await coordinator.start(streamer('streamer'));
    const target = coordinator.currentTarget();
    if (!target) throw new Error('tabless watch did not start');

    coordinator.adopt({
      target,
      ownership: { kind: 'managed-tab', tabId: 1, ownershipToken: 'token', expectedChannel: 'streamer' },
      health: { ...(await coordinator.tick()), mode: 'managed-tab' },
      obsolete: coordinator.currentOwnership(),
    });

    expect(releases()).toBe(1);
    media.requests.length = 0;
    await media.hls.sustain();
    expect(media.requests).toEqual([]);
    await coordinator.stop();
  });

  test('a newly promoted tabless watch keeps its live media', async () => {
    const { media, coordinator, releases } = coordinatorWithLiveMedia();
    await coordinator.start(streamer('first'));
    expect(await coordinator.start(streamer('second'))).toMatchObject({ kind: 'started' });

    expect(releases()).toBe(0);
    media.requests.length = 0;
    media.nextSegment();
    await media.hls.sustain();
    expect(media.requests).toEqual([
      'GET https://edge.ttvnw.net/second.m3u8',
      'HEAD https://edge.ttvnw.net/second-2.ts',
    ]);
    await coordinator.stop();
  });
});
