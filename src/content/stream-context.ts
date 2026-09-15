import { extractStreamCategory } from './stream-category.ts';

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

export function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeForCompare(value: string): string {
  const lower = value.toLowerCase();
  const normalized = lower.normalize('NFD');
  return normalized
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function extractChannelNameFromPath(): string | null {
  try {
    const parsed = new URL(window.location.href);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'player.twitch.tv') {
      return parsed.searchParams.get('channel')?.trim().toLowerCase() || null;
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

function extractStreamTitleText(): string {
  const titleNode = document.querySelector(
    '[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1[data-a-target="stream-title"], h1',
  );
  const fromNode = normalizeText(titleNode?.textContent);
  if (fromNode) {
    return fromNode;
  }
  return normalizeText(document.title.replace(/\s*-\s*Twitch.*$/i, ''));
}

function hasDropsInStreamScope(streamTitle: string): boolean {
  const titleNorm = normalizeForCompare(streamTitle);
  if (/\bdrops?\b/.test(titleNorm)) {
    return true;
  }
  const docTitleNorm = normalizeForCompare(document.title);
  if (/\bdrops?\b/.test(docTitleNorm)) {
    return true;
  }

  const titleNode = document.querySelector(
    '[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1',
  );
  const scope = titleNode?.closest('main, article, section, div') ?? document.body;
  const explicit = scope.querySelector(
    '[data-test-selector*="drops" i], [data-a-target*="drops" i], [aria-label*="drops" i], [title*="drops" i], a[href*="filter=drops"]',
  );
  if (explicit) {
    return true;
  }

  const tokens = Array.from(scope.querySelectorAll('a, span, p, button'))
    .map((node) => normalizeForCompare(node.textContent ?? ''))
    .filter((text) => text.length > 0 && text.length <= 64);
  return tokens.some(
    (token) => token === 'drops' || token === 'drops enabled' || token.includes('drops enabled'),
  );
}

function findPlayerScope(): Element | null {
  return document.querySelector(
    '.persistent-player, [data-a-target="video-player"], .video-player, [data-a-player-state]',
  );
}

function detectStreamLiveStatus(): boolean {
  // Strong positive: Twitch renders a live viewer count / uptime only while the channel is live.
  if (document.querySelector('[data-a-target="animated-channel-viewers-count"], .live-time')) {
    return true;
  }

  const playerScope = findPlayerScope();

  // Explicit offline content-gate overlay inside the player.
  const contentGate = (playerScope ?? document).querySelector(
    '[data-a-target^="player-overlay-content-gate"]',
  );
  if (contentGate && normalizeForCompare(contentGate.textContent ?? '').includes('offline')) {
    return false;
  }

  // Offline text, scoped to the player only — never the whole page. A "channel is offline"
  // string in the sidebar recommendations or chat must not flag the watched stream as down.
  if (playerScope) {
    const playerText = normalizeForCompare(playerScope.textContent ?? '');
    if (playerText.includes('this channel is offline') || playerText.includes('channel is offline')) {
      return false;
    }
  }

  // No decisive offline signal (mid-ad, player re-init, transient DOM shift): assume still
  // live and let the background's offline confirmation + stall detection decide, instead of
  // reloading the tab on a single ambiguous reading.
  return true;
}

export function extractStreamContext() {
  const channelName = extractChannelNameFromPath();
  if (!channelName) {
    return null;
  }

  const category = extractStreamCategory(document);
  const streamTitle = extractStreamTitleText();
  const titleContainsDrops = /\bdrops?\b/i.test(streamTitle) || /\bdrops?\b/i.test(document.title);
  const hasDropsSignal = hasDropsInStreamScope(streamTitle);
  const isLive = detectStreamLiveStatus();
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  const playingVideoCount = videos.filter(
    (video) => !video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
  ).length;

  return {
    channelName,
    categorySlug: category.slug,
    categoryLabel: category.label,
    streamTitle,
    titleContainsDrops,
    hasDropsSignal,
    isLive,
    videoCount: videos.length,
    playingVideoCount,
    isPlaybackReady: videos.length > 0 && playingVideoCount > 0,
    pageUrl: window.location.href,
  };
}
