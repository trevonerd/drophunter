import { browser } from '../shared/browser-api.ts';
import { logContentInfo, logContentWarn } from './logging.ts';
import { extractTwitchSessionFrom, parseCookieValue } from './session-extraction.ts';
import { normalizeText } from './stream-context.ts';

function createSessionUuid(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function extractTwitchSession() {
  const session = extractTwitchSessionFrom({
    cookieString: document.cookie,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    createSessionUuid,
  });

  if (!session) {
    logContentWarn('Content session extraction failed', {
      hasCookieAuthToken: Boolean(normalizeText(parseCookieValue(document.cookie, 'auth-token'))),
      hasCookieUniqueId: Boolean(
        normalizeText(parseCookieValue(document.cookie, 'unique_id')) ||
          normalizeText(parseCookieValue(document.cookie, 'device_id')),
      ),
    });
    return null;
  }

  logContentInfo('Content session extracted', {
    hasUserId: Boolean(session.userId),
    hasOAuthToken: Boolean(session.oauthToken),
    hasClientIntegrity: Boolean(session.clientIntegrity),
    hasDeviceId: Boolean(session.deviceId),
    hasUuid: Boolean(session.uuid),
  });

  return session;
}

export function syncTwitchSessionToBackground() {
  const session = extractTwitchSession();
  if (!session) {
    return;
  }
  browser.runtime
    .sendMessage({
      type: 'SYNC_TWITCH_SESSION',
      payload: { session },
    })
    .catch(() => undefined);
}

// The integrity-interceptor.js (MAIN world, document_start) patches fetch
// to capture Twitch's integrity tokens and stores them in sessionStorage.
// We read from sessionStorage here and also listen for real-time updates.

export const INTEGRITY_STORAGE_KEY = '__drophunter_integrity__';

export function syncIntegrityToBackground(source: string) {
  try {
    const raw = window.sessionStorage.getItem(INTEGRITY_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const detail = JSON.parse(raw) as { token?: string; expiration?: number; request_id?: string };
    if (detail && typeof detail.token === 'string' && detail.token.length > 0) {
      logContentInfo(`Integrity token from page (${source})`, {
        hasToken: true,
        expiration: detail.expiration,
      });
      browser.runtime
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

// Handle real-time integrity updates from the MAIN world interceptor
export function handleIntegrityEvent(event: Event): void {
  try {
    const customEvent = event as CustomEvent;
    const detail =
      typeof customEvent.detail === 'string' ? JSON.parse(customEvent.detail) : customEvent.detail;
    if (detail && typeof detail.token === 'string' && detail.token.length > 0) {
      logContentInfo('Intercepted Twitch integrity token (live)', {
        hasToken: true,
        expiration: detail.expiration,
      });
      browser.runtime
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
