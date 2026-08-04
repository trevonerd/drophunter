import type { FarmingTarget, TablessHeartbeat } from '../watch-transport.ts';
import {
  channelUrl,
  extractSettingsBundle,
  extractSpadeUrl,
  safeTwitchUrl,
  spadeRequestBody,
} from './spade-protocol.ts';

const TWITCH_GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
const STREAM_INFO_QUERY = `query StreamInfo($channel: String!) {
  user(login: $channel) {
    id
    stream {
      id
      type
      game { id name }
    }
  }
}`;
const DEFAULT_TIMEOUT_MS = 12_000;

export type SpadeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface TwitchSpadeHeartbeatOptions {
  readonly fetch?: SpadeFetch;
  readonly clientId?: string;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

interface StreamInfo {
  readonly channelId: string;
  readonly broadcastId: string;
  readonly gameId?: string;
  readonly gameName?: string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

const defaultFetch: SpadeFetch = (input, init) => globalThis.fetch(input, init);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstGraphQlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseStreamInfo(value: unknown): StreamInfo | null {
  const envelope = firstGraphQlValue(value);
  if (!isRecord(envelope) || !isRecord(envelope.data) || !isRecord(envelope.data.user)) {
    return null;
  }
  const user = envelope.data.user;
  const channelId = stringValue(user.id);
  const stream = isRecord(user.stream) ? user.stream : null;
  const broadcastId = stream ? stringValue(stream.id) : undefined;
  const type = stream ? stringValue(stream.type) : undefined;
  if (!channelId || !broadcastId || (type && type.toLowerCase() !== 'live')) {
    return null;
  }
  const game = stream && isRecord(stream.game) ? stream.game : null;
  return {
    channelId,
    broadcastId,
    gameId: game ? stringValue(game.id) : undefined,
    gameName: game ? stringValue(game.name) : undefined,
  };
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export interface TwitchSpadeHeartbeat {
  readonly heartbeat: (target: FarmingTarget, viewerUserId: string) => Promise<TablessHeartbeat>;
}

export function createTwitchSpadeHeartbeat(options: TwitchSpadeHeartbeatOptions = {}): TwitchSpadeHeartbeat {
  const fetchImpl = options.fetch ?? defaultFetch;
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const now = options.now ?? (() => new Date().toISOString());
  const destinations = new Map<string, string>();

  const withRequestTimeout = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () =>
          reject(new DOMException(`Twitch heartbeat request timed out after ${timeoutMs}ms`, 'TimeoutError')),
        { once: true },
      );
    });
    try {
      return await Promise.race([operation(controller.signal), aborted]);
    } finally {
      clearTimeout(timer);
    }
  };

  const request = (input: RequestInfo | URL, init: RequestInit): Promise<Response> =>
    withRequestTimeout((signal) => fetchImpl(input, { ...init, signal }));

  const requestBody = (input: RequestInfo | URL, init: RequestInit) =>
    withRequestTimeout(async (signal) => {
      const response = await fetchImpl(input, { ...init, signal });
      const body = await readResponseBody(response);
      return { response, body };
    });

  const resolveDestination = async (channelName: string): Promise<string | null> => {
    const page = safeTwitchUrl(channelUrl(channelName));
    if (!page) {
      return null;
    }
    const { response: pageResponse, body: pageBody } = await requestBody(page, {
      credentials: 'include',
      redirect: 'error',
    });
    if (!pageResponse.ok) {
      return null;
    }
    const inline = extractSpadeUrl(pageBody);
    const inlineDestination = inline ? safeTwitchUrl(inline) : null;
    if (inlineDestination) {
      return inlineDestination;
    }

    const bundle = extractSettingsBundle(pageBody);
    const bundleUrl = bundle ? safeTwitchUrl(bundle, page) : null;
    if (!bundleUrl) {
      return null;
    }
    const { response: bundleResponse, body: bundleBody } = await requestBody(bundleUrl, {
      credentials: 'include',
      redirect: 'error',
    });
    if (!bundleResponse.ok) {
      return null;
    }
    const bundledDestination = extractSpadeUrl(bundleBody);
    return bundledDestination ? safeTwitchUrl(bundledDestination) : null;
  };

  const fetchStreamInfo = async (channelName: string): Promise<StreamInfo | null> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.clientId) {
      headers['Client-Id'] = options.clientId;
    }
    const { response, body } = await requestBody(TWITCH_GQL_ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      headers,
      body: JSON.stringify({
        operationName: 'StreamInfo',
        variables: { channel: channelName },
        query: STREAM_INFO_QUERY,
      }),
    });
    if (!response.ok) {
      return null;
    }
    try {
      return parseStreamInfo(JSON.parse(body));
    } catch {
      return null;
    }
  };

  const send = async (destination: string, target: FarmingTarget, userId: string, stream: StreamInfo) => {
    const body = spadeRequestBody({
      broadcastId: stream.broadcastId,
      channelId: stream.channelId,
      channel: target.channelName.trim().toLowerCase(),
      userId,
      gameId: stream.gameId ?? target.gameId,
      gameName: stream.gameName,
      clientTime: now(),
    });
    return request(destination, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  };

  const heartbeat = async (target: FarmingTarget, viewerUserId: string): Promise<TablessHeartbeat> => {
    const channel = target.channelName.trim().toLowerCase();
    if (!channel || !viewerUserId.trim()) {
      return { accepted: false, isLive: true, reason: 'error' };
    }
    try {
      const stream = await fetchStreamInfo(channel);
      if (!stream) {
        return {
          accepted: false,
          isLive: false,
          sameChannel: true,
          sameGame: true,
          reason: 'stream-offline',
        };
      }
      if (!stream.gameId || !target.gameId || stream.gameId !== target.gameId) {
        return {
          accepted: false,
          isLive: true,
          sameChannel: true,
          sameGame: false,
          reason: 'wrong-game',
        };
      }
      const cached = destinations.get(channel);
      const firstDestination = cached ?? (await resolveDestination(channel));
      if (!firstDestination) {
        return { accepted: false, isLive: true, reason: 'error' };
      }
      destinations.set(channel, firstDestination);
      const first = await send(firstDestination, target, viewerUserId, stream);
      if (first.status === 204) {
        return { accepted: true, isLive: true, sameChannel: true, sameGame: true, reason: 'heartbeat' };
      }
      destinations.delete(channel);
      const refreshed = await resolveDestination(channel);
      if (!refreshed) {
        return { accepted: false, isLive: true, reason: 'error' };
      }
      destinations.set(channel, refreshed);
      const second = await send(refreshed, target, viewerUserId, stream);
      if (second.status === 204) {
        return { accepted: true, isLive: true, sameChannel: true, sameGame: true, reason: 'heartbeat' };
      }
      destinations.delete(channel);
      return { accepted: false, isLive: true, reason: 'heartbeat-failed' };
    } catch {
      destinations.delete(channel);
      return { accepted: false, isLive: true, reason: 'error' };
    }
  };

  return { heartbeat };
}
