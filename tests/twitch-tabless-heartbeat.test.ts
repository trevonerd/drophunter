import { describe, expect, test } from 'bun:test';
import type { HlsWatchContext } from '../src/background/twitch-api/hls-watch.ts';
import {
  createTwitchTablessHeartbeat,
  type TwitchHeartbeatFetch,
} from '../src/background/twitch-api/tabless-heartbeat.ts';

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

const liveStreamInfo = () =>
  response(
    JSON.stringify([
      {
        data: {
          user: {
            id: 'channel-1',
            stream: { id: 'broadcast-1', type: 'live', game: { id: 'game-1', name: 'Game' } },
          },
        },
      },
    ]),
  );

function recordingWatch(ok = true) {
  const calls: HlsWatchContext[] = [];
  const watch = async (context: HlsWatchContext) => {
    calls.push(context);
    return ok
      ? ({ ok: true } as const)
      : ({ ok: false, message: 'Twitch HLS playlist returned HTTP 403' } as const);
  };
  return { calls, watch };
}

describe('Twitch tabless heartbeat', () => {
  test('times out when response headers arrive but the body never settles', async () => {
    let aborted = false;
    const fetchImpl: TwitchHeartbeatFetch = async (_input, init) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return {
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => undefined),
      } as Response;
    };
    const heartbeat = createTwitchTablessHeartbeat({
      fetch: fetchImpl,
      timeoutMs: 1_000,
      watch: recordingWatch().watch,
    });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(false);
    expect(aborted).toBe(true);
  });
  test('returns offline without requesting media when StreamInfo has no live stream', async () => {
    const media = recordingWatch();
    const requests: string[] = [];
    const fetchImpl: TwitchHeartbeatFetch = async (input) => {
      requests.push(String(input));
      return response(JSON.stringify([{ data: { user: { id: '42', stream: null } } }]));
    };
    const heartbeat = createTwitchTablessHeartbeat({ fetch: fetchImpl, watch: media.watch });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'Streamer' }, 'viewer-1');

    expect(result.accepted).toBe(false);
    expect(result.isLive).toBe(false);
    expect(result.reason).toBe('stream-offline');
    expect(requests).toHaveLength(1);
    expect(media.calls).toEqual([]);
  });

  test('probes StreamInfo as offline, verified live, or unavailable without sending a watch event', async () => {
    const media = recordingWatch();
    const requests: string[] = [];
    let body = JSON.stringify([{ data: { user: { id: '42', stream: null } } }]);
    const fetchImpl: TwitchHeartbeatFetch = async (input) => {
      requests.push(String(input));
      return response(body);
    };
    const heartbeat = createTwitchTablessHeartbeat({ fetch: fetchImpl, watch: media.watch });

    expect(await heartbeat.probeStreamInfo('streamer')).toEqual({ kind: 'offline' });
    body = JSON.stringify([
      {
        data: {
          user: {
            id: '42',
            stream: { id: 'broadcast-1', type: 'live', game: { id: 'category-1', name: 'Game' } },
          },
        },
      },
    ]);
    expect(await heartbeat.probeStreamInfo('streamer')).toEqual({
      kind: 'live',
      streamer: { id: '42', name: 'streamer', displayName: 'streamer', isLive: true },
      categoryId: 'category-1',
      categoryLabel: 'Game',
    });
    body = JSON.stringify([{ data: { user: {} } }]);
    expect(await heartbeat.probeStreamInfo('streamer')).toEqual({ kind: 'unavailable' });
    expect(requests).toEqual(Array(3).fill('https://gql.twitch.tv/gql'));
    expect(media.calls).toEqual([]);
  });

  test('keeps a GraphQL rate limit typed for the gateway backoff classifier', async () => {
    const heartbeat = createTwitchTablessHeartbeat({
      fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
      watch: recordingWatch().watch,
    });

    await expect(heartbeat.probeStreamInfo('streamer')).rejects.toMatchObject({
      name: 'TwitchHttpError',
      status: 429,
      retryAfterMs: 60_000,
    });
  });

  test('does not request media when the live channel is in a different game', async () => {
    const media = recordingWatch();
    const requests: string[] = [];
    const fetchImpl: TwitchHeartbeatFetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://gql.twitch.tv/gql') {
        return response(
          JSON.stringify([
            {
              data: {
                user: {
                  id: 'channel-1',
                  stream: { id: 'broadcast-1', type: 'live', game: { id: 'other-game', name: 'Other Game' } },
                },
              },
            },
          ]),
        );
      }
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchTablessHeartbeat({ fetch: fetchImpl, watch: media.watch });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(false);
    expect(result.sameGame).toBe(false);
    expect(result.reason).toBe('wrong-game');
    expect(requests).toEqual(['https://gql.twitch.tv/gql']);
    expect(media.calls).toEqual([]);
  });

  test('requests live media for the verified broadcast, then posts minute-watched telemetry', async () => {
    const media = recordingWatch();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: TwitchHeartbeatFetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === 'https://gql.twitch.tv/gql') return liveStreamInfo();
      if (url === 'https://www.twitch.tv/streamer') {
        return new Response(
          '<html><script>window.settings={"spade_url":"https://spade.twitch.tv/events"}</script></html>',
          { status: 200 },
        );
      }
      if (url === 'https://spade.twitch.tv/events') return response('', 204);
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchTablessHeartbeat({
      fetch: fetchImpl,
      now: () => '2026-08-04T00:00:00.000Z',
      watch: media.watch,
    });

    const result = await heartbeat.heartbeat(
      { gameId: 'game-1', campaignId: 'campaign-1', channelName: 'Streamer' },
      'viewer-1',
    );

    expect(result).toMatchObject({ accepted: true, isLive: true, sameChannel: true, sameGame: true });
    expect(media.calls).toEqual([{ channel: 'streamer', broadcastId: 'broadcast-1' }]);
    const post = requests.find((request) => request.url === 'https://spade.twitch.tv/events');
    expect(post?.init?.method).toBe('POST');
    expect(post?.init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const body = String(post?.init?.body ?? '');
    expect(body.startsWith('data=')).toBe(true);
    const encoded = decodeURIComponent(body.slice('data='.length));
    const event = JSON.parse(atob(encoded)) as Array<{
      event?: string;
      properties?: Record<string, unknown>;
    }>;
    expect(event[0]?.event).toBe('minute-watched');
    expect(event[0]?.properties).toMatchObject({
      broadcast_id: 'broadcast-1',
      channel_id: 'channel-1',
      channel: 'streamer',
      user_id: 'viewer-1',
      game_id: 'game-1',
      game: 'Game',
      minutes_logged: 1,
      is_live: true,
    });
  });

  test('reports a failed heartbeat without telemetry when live media is not requested', async () => {
    const media = recordingWatch(false);
    const requests: string[] = [];
    const fetchImpl: TwitchHeartbeatFetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://gql.twitch.tv/gql') return liveStreamInfo();
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchTablessHeartbeat({ fetch: fetchImpl, watch: media.watch });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result).toEqual({ accepted: false, isLive: true, reason: 'heartbeat-failed' });
    expect(media.calls).toHaveLength(1);
    expect(requests).toEqual(['https://gql.twitch.tv/gql']);
  });

  test('resolves a Spade endpoint from Twitch settings bundle markup', async () => {
    const media = recordingWatch();
    const requests: string[] = [];
    const fetchImpl: TwitchHeartbeatFetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://gql.twitch.tv/gql') return liveStreamInfo();
      if (url === 'https://www.twitch.tv/streamer') {
        return new Response('<script src="/settings.v123.js"></script>', { status: 200 });
      }
      if (url === 'https://www.twitch.tv/settings.v123.js') {
        return new Response('window.settings={"beacon_url":"https://spade.twitch.tv/events"}', {
          status: 200,
        });
      }
      if (url === 'https://spade.twitch.tv/events') return response('', 204);
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchTablessHeartbeat({ fetch: fetchImpl, watch: media.watch });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(true);
    expect(requests).toContain('https://www.twitch.tv/settings.v123.js');
    expect(requests).toContain('https://spade.twitch.tv/events');
  });

  test('keeps an accepted watch when telemetry fails and resolves its endpoint again next time', async () => {
    const media = recordingWatch();
    let pageLoads = 0;
    let posts = 0;
    const fetchImpl: TwitchHeartbeatFetch = async (input) => {
      const url = String(input);
      if (url === 'https://gql.twitch.tv/gql') return liveStreamInfo();
      if (url === 'https://www.twitch.tv/streamer') {
        pageLoads += 1;
        return new Response(
          `<script>const config={"spade_url":"https://spade.twitch.tv/events-${pageLoads}"}</script>`,
          { status: 200 },
        );
      }
      if (url.startsWith('https://spade.twitch.tv/events-')) {
        posts += 1;
        return response('', posts === 1 ? 503 : 204);
      }
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchTablessHeartbeat({ fetch: fetchImpl, watch: media.watch });
    const target = { gameId: 'game-1', channelName: 'streamer' };

    expect((await heartbeat.heartbeat(target, 'viewer-1')).accepted).toBe(true);
    expect([pageLoads, posts]).toEqual([1, 1]);
    expect((await heartbeat.heartbeat(target, 'viewer-1')).accepted).toBe(true);
    expect((await heartbeat.heartbeat(target, 'viewer-1')).accepted).toBe(true);
    expect([pageLoads, posts]).toEqual([2, 3]);
  });
});
