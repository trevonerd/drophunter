const RESERVED_TWITCH_PATH_SEGMENTS = new Set([
  'directory',
  'drops',
  'settings',
  'subscriptions',
  'wallet',
  'privacy',
  'inventory',
  'search',
  'videos',
  'downloads',
  'turbo',
  'jobs',
  'p',
  'store',
]);

export function getFarmableTwitchChannelNameFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'player.twitch.tv') {
      const fromQuery = parsed.searchParams.get('channel')?.trim().toLowerCase();
      return fromQuery || null;
    }

    if (!/(\.|^)twitch\.tv$/i.test(hostname)) {
      return null;
    }

    const segment = parsed.pathname.split('/').filter(Boolean)[0]?.trim().toLowerCase() ?? '';
    if (!segment || RESERVED_TWITCH_PATH_SEGMENTS.has(segment)) {
      return null;
    }

    return segment;
  } catch {
    return null;
  }
}
