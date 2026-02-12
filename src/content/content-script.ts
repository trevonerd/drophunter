import { Message } from '../types';

const LOG_PREFIX = '[DropHunter]';

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function extractCategorySlugFromHref(href: string): string | null {
  const match = href.match(/\/directory\/category\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function normalizeForCompare(value: string): string {
  const lower = value.toLowerCase();
  const normalized = lower.normalize('NFD');
  return normalized
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractChannelNameFromPath(): string | null {
  if (window.location.hostname === 'player.twitch.tv') {
    const fromQuery = normalizeText(new URL(window.location.href).searchParams.get('channel'));
    if (fromQuery) {
      return fromQuery.toLowerCase();
    }
  }

  const segment = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
  const reserved = new Set([
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
  if (!segment || reserved.has(segment.toLowerCase())) {
    return null;
  }
  return segment.toLowerCase();
}

function extractStreamCategory(): { slug: string; label: string } {
  const links = Array.from(
    document.querySelectorAll('a[data-a-target="stream-game-link"], a[href*="/directory/category/"]'),
  ) as HTMLAnchorElement[];
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    const slug = extractCategorySlugFromHref(href);
    if (!slug) {
      continue;
    }
    const label = normalizeText(link.textContent) || slug.replace(/-/g, ' ');
    return { slug, label };
  }
  return { slug: '', label: '' };
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

function detectStreamLiveStatus(): boolean {
  const hasVideo = document.querySelector('video') !== null;
  if (!hasVideo) {
    return false;
  }
  const pageText = normalizeForCompare(document.body?.textContent ?? '');
  if (pageText.includes('this channel is offline') || pageText.includes('channel is offline')) {
    return false;
  }
  return true;
}

function extractStreamContext() {
  const channelName = extractChannelNameFromPath();
  if (!channelName) {
    return null;
  }

  const category = extractStreamCategory();
  const streamTitle = extractStreamTitleText();
  const titleContainsDrops = /\bdrops?\b/i.test(streamTitle) || /\bdrops?\b/i.test(document.title);
  const hasDropsSignal = hasDropsInStreamScope(streamTitle);
  const isLive = detectStreamLiveStatus();

  return {
    channelName,
    categorySlug: category.slug,
    categoryLabel: category.label,
    streamTitle,
    titleContainsDrops,
    hasDropsSignal,
    isLive,
    pageUrl: window.location.href,
  };
}

function prepareStreamPlayback() {
  const channelName = extractChannelNameFromPath();
  if (!channelName) {
    return {
      played: false,
      unmuted: false,
      volumeAdjusted: false,
      clickedSurface: false,
      isAudioReady: false,
      gateDismissed: false,
    };
  }

  // Auto-dismiss mature content warning gate
  const gateButton =
    (document.querySelector(
      'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
    ) as HTMLButtonElement | null) ||
    (Array.from(document.querySelectorAll('button')).find((btn) =>
      normalizeForCompare(btn.textContent ?? '').includes('start watching'),
    ) as HTMLButtonElement | undefined) ||
    null;

  if (gateButton) {
    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    gateButton.dispatchEvent(clickEvt);
    return {
      played: false,
      unmuted: false,
      volumeAdjusted: false,
      clickedSurface: false,
      isAudioReady: false,
      gateDismissed: true,
    };
  }

  let played = false;
  let unmuted = false;
  let volumeAdjusted = false;
  let clickedSurface = false;

  const clickElement = (element: Element | null | undefined) => {
    if (!element) {
      return;
    }
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    element.dispatchEvent(mouseDown);
    element.dispatchEvent(mouseUp);
    element.dispatchEvent(click);
    clickedSurface = true;
  };

  const playerSurface =
    (document.querySelector('[data-a-target="video-player"]') as HTMLElement | null) ||
    (document.querySelector('[data-a-player-state]') as HTMLElement | null) ||
    (document.querySelector('div[data-test-selector*="video-player"]') as HTMLElement | null);
  clickElement(playerSurface);

  const playPauseButton = document.querySelector(
    '[data-a-target="player-play-pause-button"]',
  ) as HTMLButtonElement | null;
  if (playPauseButton) {
    const label = normalizeForCompare(
      playPauseButton.getAttribute('aria-label') ?? playPauseButton.textContent ?? '',
    );
    if (label.includes('play')) {
      playPauseButton.click();
      played = true;
    }
  }

  const muteButton = document.querySelector(
    '[data-a-target="player-mute-unmute-button"]',
  ) as HTMLButtonElement | null;
  if (muteButton) {
    const label = normalizeForCompare(muteButton.getAttribute('aria-label') ?? muteButton.textContent ?? '');
    if (label.includes('unmute')) {
      muteButton.click();
      unmuted = true;
    }
  }

  const overlayUnmuteButton = document.querySelector(
    '[data-a-target="player-overlay-mute-unmute-button"]',
  ) as HTMLButtonElement | null;
  if (overlayUnmuteButton) {
    const label = normalizeForCompare(
      overlayUnmuteButton.getAttribute('aria-label') ?? overlayUnmuteButton.textContent ?? '',
    );
    if (label.includes('unmute')) {
      overlayUnmuteButton.click();
      unmuted = true;
    }
  }

  const volumeSlider = document.querySelector(
    'input[data-a-target="player-volume-slider"]',
  ) as HTMLInputElement | null;
  if (volumeSlider) {
    const currentValue = Number.parseFloat(volumeSlider.value || '0');
    if (!Number.isFinite(currentValue) || currentValue <= 0.01) {
      volumeSlider.value = '0.35';
      volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
      volumeSlider.dispatchEvent(new Event('change', { bubbles: true }));
      volumeAdjusted = true;
    }
  }

  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (video) {
    clickElement(video);
    // Only attempt programmatic unmute when the page has received a user
    // gesture; otherwise Chrome logs "Unmuting failed and the element was
    // paused instead because the user didn't interact with the document
    // before." A muted video still accrues drop watch time.
    if (video.muted && navigator.userActivation?.hasBeenActive) {
      const wasPlaying = !video.paused;
      video.muted = false;
      // Chrome autoplay policy may pause the video when unmuted programmatically.
      // Revert to muted playback — a playing muted video still accrues drop watch time.
      if (wasPlaying && video.paused) {
        video.muted = true;
        video.play().catch(() => undefined);
      } else {
        unmuted = true;
      }
    }
    if (video.volume <= 0.01) {
      video.volume = 0.35;
      volumeAdjusted = true;
    }
    if (video.paused) {
      video.play().catch(() => undefined);
      played = true;
    }
  }

  const isAudioReady = Boolean(video && !video.paused && !video.muted && video.volume > 0.01);
  return { played, unmuted, volumeAdjusted, clickedSurface, isAudioReady, gateDismissed: false };
}

function getCookieValue(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function parseTwilightUserEntry(): { oauthToken: string; userId: string } {
  const keys = [
    'twilight-user',
    'twilight-user-data',
    'twilight-user-data-v2',
    '__twilight-user',
    'twilight-session',
  ];
  const stores: Storage[] = [window.localStorage, window.sessionStorage];
  for (const store of stores) {
    for (const key of keys) {
      const raw = store.getItem(key);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const asText = (value: unknown): string => (typeof value === 'string' ? normalizeText(value) : '');
        const parsedUser =
          parsed.user && typeof parsed.user === 'object' ? (parsed.user as Record<string, unknown>) : null;
        const oauthToken =
          asText(parsed.authToken) ||
          asText(parsed.token) ||
          asText(parsed.accessToken) ||
          asText(parsed.oauthToken);
        const userId =
          asText(parsed.userID) || asText(parsed.userId) || asText(parsed.id) || asText(parsedUser?.id);
        if (oauthToken || userId) {
          return { oauthToken, userId };
        }
      } catch {
        // Ignore malformed entries.
      }
    }
  }
  return { oauthToken: '', userId: '' };
}

function createSessionUuid(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('');
}

function extractTwitchSession() {
  const twilight = parseTwilightUserEntry();
  const oauthToken =
    twilight.oauthToken ||
    normalizeText(getCookieValue('auth-token')) ||
    normalizeText(getCookieValue('__Secure-auth-token'));
  const userId = twilight.userId;
  const deviceId =
    normalizeText(window.localStorage.getItem('local_copy_unique_id')) ||
    normalizeText(window.localStorage.getItem('device_id')) ||
    normalizeText(window.localStorage.getItem('deviceId')) ||
    normalizeText(window.sessionStorage.getItem('local_copy_unique_id')) ||
    normalizeText(window.sessionStorage.getItem('device_id')) ||
    normalizeText(window.sessionStorage.getItem('deviceId')) ||
    normalizeText(getCookieValue('unique_id')) ||
    normalizeText(getCookieValue('__Secure-unique_id')) ||
    normalizeText(getCookieValue('device_id'));
  const uuid =
    normalizeText(window.localStorage.getItem('client-session-id')) ||
    normalizeText(window.localStorage.getItem('clientSessionId')) ||
    normalizeText(window.sessionStorage.getItem('client-session-id')) ||
    normalizeText(window.sessionStorage.getItem('clientSessionId')) ||
    createSessionUuid();
  const clientIntegrity =
    normalizeText(window.localStorage.getItem('client-integrity')) ||
    normalizeText(window.localStorage.getItem('clientIntegrity'));

  if (!oauthToken || !deviceId) {
    console.warn(LOG_PREFIX, 'Content session extraction failed', {
      hasOAuthToken: Boolean(oauthToken),
      hasUserId: Boolean(userId),
      hasDeviceId: Boolean(deviceId),
      hasClientIntegrity: Boolean(clientIntegrity),
      hasCookieAuthToken: Boolean(normalizeText(getCookieValue('auth-token'))),
      hasCookieUniqueId: Boolean(
        normalizeText(getCookieValue('unique_id')) || normalizeText(getCookieValue('device_id')),
      ),
    });
    return null;
  }

  console.info(LOG_PREFIX, 'Content session extracted', {
    userId,
    oauthTokenLength: oauthToken.length,
    hasClientIntegrity: Boolean(clientIntegrity),
    deviceIdSuffix: deviceId.slice(-6),
    uuid,
  });

  return {
    oauthToken,
    userId: userId || '',
    deviceId,
    uuid,
    clientIntegrity: clientIntegrity || undefined,
  };
}

function syncTwitchSessionToBackground() {
  const session = extractTwitchSession();
  if (!session) {
    return;
  }
  chrome.runtime
    .sendMessage({
      type: 'SYNC_TWITCH_SESSION',
      payload: { session },
    })
    .catch(() => undefined);
}

function showToast(message: string) {
  const id = 'drophunter-toast';
  const existing = document.getElementById(id);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = id;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    maxWidth: '360px',
    background: 'rgba(20, 20, 25, 0.95)',
    color: '#fff',
    border: '1px solid rgba(145, 70, 255, 0.7)',
    borderRadius: '12px',
    padding: '12px 14px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    fontSize: '13px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5500);
}

function playBeep(kind: 'drop-complete' | 'all-complete') {
  // AudioContext requires a prior user gesture; skip entirely when the page
  // has never been activated to avoid the Chrome console warning:
  // "The AudioContext was not allowed to start."
  if (!navigator.userActivation?.hasBeenActive) {
    return;
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      return;
    }
    const ctx = new AudioCtx();
    const sequence = kind === 'all-complete' ? [680, 860, 1020] : [740, 980];

    let lastEnd = 0;
    sequence.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.value = 0.0001;

      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = ctx.currentTime + index * 0.18;
      const end = start + 0.14;
      lastEnd = end;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.start(start);
      osc.stop(end);
    });

    // Close AudioContext after all oscillators finish
    const closeDelayMs = Math.max(0, (lastEnd - ctx.currentTime) * 1000) + 200;
    setTimeout(() => ctx.close().catch(() => undefined), closeDelayMs);
  } catch {
    // Audio cue is non-critical — silently ignore failures.
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_TWITCH_SESSION': {
      const session = extractTwitchSession();
      sendResponse({ success: Boolean(session), session });
      break;
    }
    case 'GET_STREAM_CONTEXT': {
      sendResponse({ success: true, context: extractStreamContext() });
      break;
    }
    case 'PREPARE_STREAM_PLAYBACK': {
      sendResponse({ success: true, ...prepareStreamPlayback() });
      break;
    }
    case 'PLAY_ALERT': {
      const payload = (message.payload ?? {}) as Record<string, string | undefined>;
      const kind = payload.kind === 'all-complete' ? 'all-complete' : 'drop-complete';
      const text =
        normalizeText(payload.message) ||
        (kind === 'all-complete' ? 'All drops completed.' : 'Drop completed.');
      playBeep(kind);
      showToast(text);
      sendResponse({ success: true });
      break;
    }
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true;
});

// The integrity-interceptor.js (MAIN world, document_start) patches fetch
// to capture Twitch's integrity tokens and stores them in sessionStorage.
// We read from sessionStorage here and also listen for real-time updates.

const INTEGRITY_STORAGE_KEY = '__drophunter_integrity__';

function syncIntegrityToBackground(source: string) {
  try {
    const raw = window.sessionStorage.getItem(INTEGRITY_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const detail = JSON.parse(raw) as { token?: string; expiration?: number; request_id?: string };
    if (detail && typeof detail.token === 'string' && detail.token.length > 0) {
      console.info(LOG_PREFIX, `Integrity token from page (${source})`, {
        tokenLength: detail.token.length,
        expiration: detail.expiration,
      });
      chrome.runtime
        .sendMessage({
          type: 'SYNC_TWITCH_INTEGRITY',
          payload: detail,
        })
        .catch(() => undefined);
    }
  } catch {
    // Ignore parse errors
  }
}

// Listen for real-time integrity updates from the MAIN world interceptor
window.addEventListener(INTEGRITY_STORAGE_KEY, ((event: CustomEvent) => {
  try {
    const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
    if (detail && typeof detail.token === 'string' && detail.token.length > 0) {
      console.info(LOG_PREFIX, 'Intercepted Twitch integrity token (live)', {
        tokenLength: detail.token.length,
        expiration: detail.expiration,
      });
      chrome.runtime
        .sendMessage({
          type: 'SYNC_TWITCH_INTEGRITY',
          payload: detail,
        })
        .catch(() => undefined);
    }
  } catch {
    // Ignore parse errors
  }
}) as EventListener);

// Read any integrity token that was already captured before this script loaded
syncIntegrityToBackground('sessionStorage');

window.setTimeout(() => {
  syncTwitchSessionToBackground();
  // Re-check sessionStorage in case integrity was fetched between page load
  // and content script initialization
  syncIntegrityToBackground('delayed-check');
}, 900);
