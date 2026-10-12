// Live HLS watch, adapted from lurkloot (Apache-2.0, https://github.com/jamezrin/lurkloot).
// Twitch credits Drops progress only to viewers that request live media; a
// minute-watched beacon alone no longer counts. Each poll reads the lowest
// variant's media playlist and requests the newest unseen segments with HEAD.
import type { PlaybackAccessToken } from './types.ts';

// Twitch's rolling media playlist must be read while it still lists new
// segments, so polling continues between the coarser farming ticks.
const HLS_SUSTAIN_INTERVAL_MS = 10_000;
// Sustaining stops by itself when farming ticks stop arriving.
const HLS_SUSTAIN_STALE_MS = 150_000;
const HLS_SEGMENT_CACHE_LIMIT = 256;
// Only the newest segments prove the viewer is at the live edge.
const HLS_SEGMENTS_PER_POLL = 6;
const HLS_POLL_BUDGET_MS = 8_000;
const HLS_REQUEST_TIMEOUT_MS = 3_000;
const HLS_REDIRECT_LIMIT = 3;
// A failed playback-token request waits before the next one, doubling up to
// the maximum, so a rejection does not mint a token on every poll.
const HLS_TOKEN_RETRY_MS = 60_000;
const HLS_TOKEN_RETRY_MAX_MS = 10 * 60_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CHANNEL_LOGIN = /^[a-z0-9_]+$/;

export type HlsFetch = (input: string, init: RequestInit) => Promise<Response>;

export type HlsPollResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface HlsWatchContext {
  readonly channel: string;
  readonly broadcastId: string;
}

export interface HlsWatchOptions {
  readonly fetchPlaybackToken: (channel: string) => Promise<PlaybackAccessToken | null>;
  readonly fetch?: HlsFetch;
  readonly now?: () => number;
  /** Called with true when sustained polling starts and false whenever it stops. */
  readonly onSustainChange?: (sustaining: boolean) => void;
}

export interface HlsWatch {
  readonly poll: (context: HlsWatchContext) => Promise<HlsPollResult>;
  readonly sustain: () => Promise<void>;
  /** Ends the current watch; the next poll starts a fresh one. */
  readonly release: () => void;
}

type PlaylistKind = 'master' | 'media';

/** Signed playlist and segment URLs may only reach Twitch's video CDN. */
export function isAllowedHlsUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      (hostname === 'ttvnw.net' || hostname.endsWith('.ttvnw.net'))
    );
  } catch {
    return false;
  }
}

/**
 * Lists variant (master) or segment (media) URLs. A URI without its tag, or a
 * tag left hanging at the end, rejects the whole body.
 */
export function playlistUrls(body: string, base: string, kind: PlaylistKind): string[] {
  if (!body.trim().startsWith('#EXTM3U') || !isAllowedHlsUrl(base)) return [];
  const tag = kind === 'master' ? '#EXT-X-STREAM-INF:' : '#EXTINF:';
  const urls: string[] = [];
  let pending = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (line.startsWith(tag)) pending = true;
      continue;
    }
    if (!pending) return [];
    let resolved: URL;
    try {
      resolved = new URL(line, base);
    } catch {
      return [];
    }
    if (!isAllowedHlsUrl(resolved.href)) return [];
    if (kind === 'master' && !resolved.pathname.endsWith('.m3u8')) return [];
    urls.push(resolved.href);
    pending = false;
  }
  return pending ? [] : urls;
}

function failed(message: string): HlsPollResult {
  return { ok: false, message };
}

// Diagnostics keep a short cause; signed URLs and tokens never leave this module.
function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return message && message.length <= 240 && !/[?#]|https?:\/\//i.test(message)
    ? message
    : 'Twitch HLS watch failed';
}

const defaultFetch: HlsFetch = (input, init) => globalThis.fetch(input, init);

export function createHlsWatch(options: HlsWatchOptions): HlsWatch {
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  let abort = new AbortController();
  let context: HlsWatchContext | null = null;
  let playlistUrl: string | null = null;
  let tokenFailures = 0;
  let tokenRetryAt = 0;
  let lastTickAt = 0;
  let sustainTimer: ReturnType<typeof setInterval> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let queued = 0;
  const seen = new Set<string>();

  const reset = () => {
    abort.abort();
    abort = new AbortController();
    context = null;
    playlistUrl = null;
    tokenFailures = 0;
    tokenRetryAt = 0;
    seen.clear();
  };

  const remember = (segment: string) => {
    seen.add(segment);
    if (seen.size > HLS_SEGMENT_CACHE_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };

  // Redirects are followed here so a signed URL never reaches a host outside the CDN.
  const exchange = async (url: string, method: 'GET' | 'HEAD', signal: AbortSignal) => {
    let current = url;
    for (let hop = 0; hop <= HLS_REDIRECT_LIMIT; hop += 1) {
      if (!isAllowedHlsUrl(current)) throw new Error('Twitch HLS response came from an unexpected host');
      const response = await fetchImpl(current, {
        method,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([signal, AbortSignal.timeout(HLS_REQUEST_TIMEOUT_MS)]),
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location')?.trim();
        if (!location || !URL.canParse(location, current)) {
          throw new Error('Twitch HLS redirect could not be verified');
        }
        current = new URL(location, current).href;
        continue;
      }
      // Status 0 is an opaque redirect whose destination cannot be checked.
      if (response.status === 0) throw new Error('Twitch HLS redirect could not be verified');
      const body = method === 'GET' && response.status === 200 ? await response.text() : '';
      return { status: response.status, url: current, body };
    }
    throw new Error('Twitch HLS redirect was not followed');
  };

  const acquirePlaylist = async (channel: string, signal: AbortSignal): Promise<string | null> => {
    const token = await options.fetchPlaybackToken(channel);
    signal.throwIfAborted();
    if (!token) return null;
    const master = new URL(`https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8`);
    master.searchParams.set('allow_audio_only', 'true');
    master.searchParams.set('allow_source', 'true');
    master.searchParams.set('sig', token.signature);
    master.searchParams.set('token', token.value);
    const response = await exchange(master.href, 'GET', signal);
    if (response.status !== 200) return null;
    // Twitch lists the audio-only variant last; it is the cheapest live media.
    const variants = playlistUrls(response.body, response.url, 'master');
    return variants[variants.length - 1] ?? null;
  };

  const requestLiveEdge = async (channel: string, signal: AbortSignal): Promise<HlsPollResult> => {
    if (!playlistUrl) {
      const acquired = await acquirePlaylist(channel, signal);
      if (!acquired) return failed('Twitch did not return a playback playlist');
      playlistUrl = acquired;
    }
    const media = await exchange(playlistUrl, 'GET', signal);
    if (media.status !== 200) {
      if (media.status === 401 || media.status === 403 || media.status === 404) playlistUrl = null;
      return failed(`Twitch HLS playlist returned HTTP ${media.status}`);
    }
    const segments = playlistUrls(media.body, media.url, 'media');
    if (segments.length === 0) {
      playlistUrl = null;
      return failed('Twitch HLS playlist was not usable');
    }
    const unseen = segments.filter((segment) => !seen.has(segment));
    // Older segments are behind the live edge; skip them for good.
    for (const segment of unseen.slice(0, -HLS_SEGMENTS_PER_POLL)) remember(segment);
    const batch = unseen.slice(-HLS_SEGMENTS_PER_POLL);
    let requested = 0;
    let failure: string | null = null;
    for (const segment of batch) {
      try {
        const response = await exchange(segment, 'HEAD', signal);
        if (response.status === 200) {
          remember(segment);
          requested += 1;
          continue;
        }
        if (response.status === 401 || response.status === 403 || response.status === 404) playlistUrl = null;
        failure ??= `Twitch HLS segment returned HTTP ${response.status}`;
      } catch (error) {
        signal.throwIfAborted();
        failure ??= safeFailure(error);
      }
    }
    // One live-edge segment credits the minute; failed siblings are retried next poll.
    return batch.length === 0 || requested > 0 ? { ok: true } : failed(failure ?? 'Twitch HLS watch failed');
  };

  const watchOnce = async (channel: string): Promise<HlsPollResult> => {
    const stop = abort.signal;
    const acquiring = playlistUrl === null;
    if (acquiring && now() < tokenRetryAt) {
      return failed('Twitch HLS watch is waiting to request a new playback token');
    }
    const signal = AbortSignal.any([stop, AbortSignal.timeout(HLS_POLL_BUDGET_MS)]);
    let result: HlsPollResult;
    try {
      result = await requestLiveEdge(channel, signal);
    } catch (error) {
      result = failed(signal.aborted ? 'Twitch HLS watch timed out' : safeFailure(error));
    }
    if (stop.aborted) return failed('Twitch HLS watch stopped');
    if (result.ok) {
      tokenFailures = 0;
      tokenRetryAt = 0;
    } else if (acquiring && playlistUrl === null) {
      tokenFailures += 1;
      tokenRetryAt = now() + Math.min(HLS_TOKEN_RETRY_MS * 2 ** (tokenFailures - 1), HLS_TOKEN_RETRY_MAX_MS);
    }
    return result;
  };

  // Polls never overlap: the seen-segment cache and playlist URL are shared.
  const exclusive = (channel: string): Promise<HlsPollResult> => {
    queued += 1;
    const run = queue.then(() => watchOnce(channel));
    queue = run.finally(() => {
      queued -= 1;
    });
    return run;
  };

  const stopSustain = () => {
    if (sustainTimer !== null) clearInterval(sustainTimer);
    sustainTimer = null;
    options.onSustainChange?.(false);
  };

  const startSustain = () => {
    if (sustainTimer !== null) return;
    sustainTimer = setInterval(() => void sustain(), HLS_SUSTAIN_INTERVAL_MS);
    options.onSustainChange?.(true);
  };

  const poll = async (next: HlsWatchContext): Promise<HlsPollResult> => {
    const channel = next.channel.trim().toLowerCase();
    if (!CHANNEL_LOGIN.test(channel)) return failed('Twitch HLS watch has no channel login');
    if (context?.channel !== channel || context.broadcastId !== next.broadcastId) {
      reset();
      context = { channel, broadcastId: next.broadcastId };
    }
    lastTickAt = now();
    const result = await exclusive(channel);
    if (context?.channel !== channel) return result;
    if (result.ok) startSustain();
    else stopSustain();
    return result;
  };

  async function sustain(): Promise<void> {
    if (!context || now() - lastTickAt > HLS_SUSTAIN_STALE_MS) {
      stopSustain();
      return;
    }
    if (queued > 0 || (playlistUrl === null && now() < tokenRetryAt)) return;
    await exclusive(context.channel);
  }

  const release = () => {
    reset();
    stopSustain();
  };

  return { poll, sustain, release };
}
