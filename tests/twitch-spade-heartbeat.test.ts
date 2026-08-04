import { describe, expect, test } from 'bun:test';
import { createTwitchSpadeHeartbeat, type SpadeFetch } from '../src/background/twitch-api/spade-heartbeat.ts';

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('Twitch Spade heartbeat', () => {
  test('times out when response headers arrive but the body never settles', async () => {
    let aborted = false;
    const fetchImpl: SpadeFetch = async (_input, init) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return {
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => undefined),
      } as Response;
    };
    const heartbeat = createTwitchSpadeHeartbeat({ fetch: fetchImpl, timeoutMs: 1_000 });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(false);
    expect(aborted).toBe(true);
  });
  test('returns offline without posting when StreamInfo has no live stream', async () => {
    const requests: string[] = [];
    const fetchImpl: SpadeFetch = async (input) => {
      requests.push(String(input));
      return response(JSON.stringify([{ data: { user: { id: '42', stream: null } } }]));
    };
    const heartbeat = createTwitchSpadeHeartbeat({ fetch: fetchImpl });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'Streamer' }, 'viewer-1');

    expect(result.accepted).toBe(false);
    expect(result.isLive).toBe(false);
    expect(result.reason).toBe('stream-offline');
    expect(requests).toHaveLength(1);
  });

  test('does not post when the live channel is in a different game', async () => {
    const requests: string[] = [];
    const fetchImpl: SpadeFetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://gql.twitch.tv/gql') {
        return response(
          JSON.stringify([
            {
              data: {
                user: {
                  id: 'channel-1',
                  stream: { id: 'broadcast-1', game: { id: 'other-game', name: 'Other Game' } },
                },
              },
            },
          ]),
        );
      }
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchSpadeHeartbeat({ fetch: fetchImpl });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(false);
    expect(result.sameGame).toBe(false);
    expect(result.reason).toBe('wrong-game');
    expect(requests).toEqual(['https://gql.twitch.tv/gql']);
  });

  test('resolves a Twitch Spade endpoint and posts the minute-watched event', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: SpadeFetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === 'https://gql.twitch.tv/gql') {
        return response(
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
      }
      if (url === 'https://www.twitch.tv/streamer') {
        return new Response(
          '<html><script>window.settings={"spade_url":"https://spade.twitch.tv/events"}</script></html>',
          {
            status: 200,
          },
        );
      }
      if (url === 'https://spade.twitch.tv/events') {
        return response('', 204);
      }
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchSpadeHeartbeat({ fetch: fetchImpl, now: () => '2026-08-04T00:00:00.000Z' });

    const result = await heartbeat.heartbeat(
      { gameId: 'game-1', campaignId: 'campaign-1', channelName: 'Streamer' },
      'viewer-1',
    );

    expect(result.accepted).toBe(true);
    expect(result.isLive).toBe(true);
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

  test('resolves a Spade endpoint from Twitch settings bundle markup', async () => {
    const requests: string[] = [];
    const fetchImpl: SpadeFetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://gql.twitch.tv/gql') {
        return response(
          JSON.stringify([
            {
              data: {
                user: {
                  id: 'channel-1',
                  stream: { id: 'broadcast-1', game: { id: 'game-1', name: 'Game' } },
                },
              },
            },
          ]),
        );
      }
      if (url === 'https://www.twitch.tv/streamer') {
        return new Response('<script src="/settings.v123.js"></script>', { status: 200 });
      }
      if (url === 'https://www.twitch.tv/settings.v123.js') {
        return new Response('window.settings={"beacon_url":"https://spade.twitch.tv/events"}', {
          status: 200,
        });
      }
      if (url === 'https://spade.twitch.tv/events') {
        return response('', 204);
      }
      throw new Error(`unexpected request ${url}`);
    };
    const heartbeat = createTwitchSpadeHeartbeat({ fetch: fetchImpl });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(true);
    expect(requests).toContain('https://www.twitch.tv/settings.v123.js');
    expect(requests).toContain('https://spade.twitch.tv/events');
  });

  test('refreshes a cached endpoint once after a failed Spade POST', async () => {
    let pageLoads = 0;
    let posts = 0;
    const fetchImpl: SpadeFetch = async (input) => {
      const url = String(input);
      if (url === 'https://gql.twitch.tv/gql') {
        return response(
          JSON.stringify([
            {
              data: {
                user: {
                  id: 'channel-1',
                  stream: { id: 'broadcast-1', game: { id: 'game-1', name: 'Game' } },
                },
              },
            },
          ]),
        );
      }
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
    const heartbeat = createTwitchSpadeHeartbeat({ fetch: fetchImpl });

    const result = await heartbeat.heartbeat({ gameId: 'game-1', channelName: 'streamer' }, 'viewer-1');

    expect(result.accepted).toBe(true);
    expect(pageLoads).toBe(2);
    expect(posts).toBe(2);
  });
});
