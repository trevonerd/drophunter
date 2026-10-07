import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
import { isVideoPlaybackAdvancing, resetPlaybackObservation } from './playback.ts';
import { extractStreamCategory } from './stream-category.ts';

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
  return getFarmableTwitchChannelNameFromUrl(window.location.href);
}

export function isStreamNavigationPending(): boolean {
  const key = '__drophunter_route_target_v1';
  const target = globalThis.sessionStorage?.getItem(key);
  if (!target) return false;
  const headerHref = document.querySelector('main h1')?.closest('a')?.getAttribute('href');
  if (
    target !== window.location.href ||
    (headerHref &&
      getFarmableTwitchChannelNameFromUrl(new URL(headerHref, target).href) === extractChannelNameFromPath())
  ) {
    globalThis.sessionStorage.removeItem(key);
    for (const video of document.querySelectorAll('video')) resetPlaybackObservation(video);
    return false;
  }
  return true;
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
  const playerScope = findPlayerScope();

  // Explicit offline content-gate overlay inside the player.
  const contentGate = (playerScope ?? document).querySelector(
    '[data-a-target^="player-overlay-content-gate"]',
  );
  if (contentGate && normalizeForCompare(contentGate.textContent ?? '').includes('offline')) {
    return false;
  }

  // The offline gate wins over a viewer count left behind during stream shutdown.
  if (document.querySelector('[data-a-target="animated-channel-viewers-count"], .live-time')) {
    return true;
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

  const navigationPending = isStreamNavigationPending();
  const category = navigationPending ? { slug: '', label: '' } : extractStreamCategory(document);
  const streamTitle = extractStreamTitleText();
  const titleContainsDrops = /\bdrops?\b/i.test(streamTitle) || /\bdrops?\b/i.test(document.title);
  const hasDropsSignal = hasDropsInStreamScope(streamTitle);
  const isLive = navigationPending || detectStreamLiveStatus();
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  const playingVideoCount = navigationPending
    ? 0
    : videos.filter((video) => isVideoPlaybackAdvancing(video)).length;

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
