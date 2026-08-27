import { browser } from '../shared/browser-api.ts';
import { logDebug, logWarn } from './logging.ts';
import { sessionDebugSummary } from './state-persistence.ts';
import { sanitizeTwitchSession, type TwitchSession } from './twitch-api/types.ts';

export async function readTwitchSessionViaExecuteScript(tabId: number): Promise<TwitchSession | null> {
  try {
    const execution = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
        const normalizeToken = (value: unknown): string =>
          normalize(value)
            .replace(/^oauth:/i, '')
            .replace(/^oauth\s+/i, '')
            .trim();
        const getCookie = (name: string): string => {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
          return match?.[1] ? decodeURIComponent(match[1]) : '';
        };
        const parseTwilight = (): { oauthToken: string; userId: string } => {
          const keys = [
            'twilight-user',
            'twilight-user-data',
            'twilight-user-data-v2',
            '__twilight-user',
            'twilight-session',
          ];
          for (const store of [window.localStorage, window.sessionStorage]) {
            for (const key of keys) {
              const raw = store.getItem(key);
              if (!raw) continue;
              try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                const parsedUser =
                  parsed.user && typeof parsed.user === 'object'
                    ? (parsed.user as Record<string, unknown>)
                    : null;
                const oauthToken =
                  normalizeToken(parsed.authToken) ||
                  normalizeToken(parsed.token) ||
                  normalizeToken(parsed.accessToken) ||
                  normalizeToken(parsed.oauthToken);
                const userId =
                  normalize(parsed.userID) ||
                  normalize(parsed.userId) ||
                  normalize(parsed.id) ||
                  normalize(parsedUser?.id);
                if (oauthToken || userId) return { oauthToken, userId };
              } catch {}
            }
          }
          return { oauthToken: '', userId: '' };
        };

        const twilight = parseTwilight();
        const oauthToken =
          twilight.oauthToken ||
          normalizeToken(getCookie('auth-token')) ||
          normalizeToken(getCookie('__Secure-auth-token'));
        const deviceId =
          normalize(window.localStorage.getItem('local_copy_unique_id')) ||
          normalize(window.localStorage.getItem('device_id')) ||
          normalize(window.localStorage.getItem('deviceId')) ||
          normalize(window.sessionStorage.getItem('local_copy_unique_id')) ||
          normalize(window.sessionStorage.getItem('device_id')) ||
          normalize(window.sessionStorage.getItem('deviceId')) ||
          normalize(getCookie('unique_id')) ||
          normalize(getCookie('__Secure-unique_id')) ||
          normalize(getCookie('device_id'));
        const uuid =
          normalize(window.localStorage.getItem('client-session-id')) ||
          normalize(window.localStorage.getItem('clientSessionId')) ||
          normalize(window.sessionStorage.getItem('client-session-id')) ||
          normalize(window.sessionStorage.getItem('clientSessionId')) ||
          Math.random().toString(16).slice(2, 10);
        const clientIntegrity =
          normalize(window.localStorage.getItem('client-integrity')) ||
          normalize(window.localStorage.getItem('clientIntegrity'));
        if (!oauthToken || !deviceId) return null;
        return {
          oauthToken,
          userId: twilight.userId || '',
          deviceId,
          uuid,
          clientIntegrity: clientIntegrity || undefined,
        };
      },
    });
    const session = sanitizeTwitchSession(execution[0]?.result);
    if (session) {
      logDebug('Extracted Twitch session via executeScript', { tabId, ...sessionDebugSummary(session) });
      return session;
    }
    logWarn('executeScript session extraction returned empty payload', { tabId });
    return null;
  } catch (error) {
    logWarn('executeScript session extraction failed', { tabId, error: String(error) });
    return null;
  }
}
