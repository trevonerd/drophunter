export function safeTwitchUrl(value: string, base?: string): string | null {
  try {
    const parsed = new URL(value, base);
    if (parsed.protocol !== 'https:') return null;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'twitch.tv' && !hostname.endsWith('.twitch.tv')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractSpadeUrl(source: string): string | undefined {
  for (const key of ['spade_url', 'beacon_url']) {
    const match = source.match(new RegExp(`["']${key}["']\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, 'i'));
    const encoded = match?.[1];
    if (!encoded) continue;
    try {
      const parsed: unknown = JSON.parse(encoded);
      if (typeof parsed === 'string' && parsed.length > 0) return parsed;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return undefined;
}

export function extractSettingsBundle(source: string): string | undefined {
  const scripts = source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi);
  for (const script of scripts) {
    const candidate = script[1];
    if (candidate && /settings[^/]*\.js(?:[?#]|$)/i.test(candidate)) return candidate;
  }
  return undefined;
}

export function channelUrl(channelName: string): string {
  return `https://www.twitch.tv/${encodeURIComponent(channelName.trim().toLowerCase())}`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function spadeRequestBody(input: {
  readonly broadcastId: string;
  readonly channelId: string;
  readonly channel: string;
  readonly userId: string;
  readonly gameId?: string;
  readonly gameName?: string;
  readonly clientTime: string;
}): string {
  const event = JSON.stringify([
    {
      event: 'minute-watched',
      properties: {
        broadcast_id: input.broadcastId,
        channel_id: input.channelId,
        channel: input.channel,
        client_time: input.clientTime,
        game: input.gameName ?? '',
        game_id: input.gameId ?? '',
        hidden: false,
        is_live: true,
        live: true,
        logged_in: true,
        minutes_logged: 1,
        muted: false,
        user_id: input.userId,
      },
    },
  ]);
  return `data=${encodeURIComponent(encodeBase64(event))}`;
}
