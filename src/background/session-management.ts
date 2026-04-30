import { TWITCH_SESSION_STORAGE_KEY } from './constants.ts';
import { logDebug, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './service-worker.ts';
import { sessionDebugSummary } from './state-persistence.ts';
import { fetchTwitchIntegrityToken } from './twitch-api/gql.ts';
import { sanitizeTwitchSession, TwitchSession } from './twitch-api/types.ts';

export async function persistTwitchSession(session: TwitchSession | null) {
  if (session) {
    await chrome.storage.local.set({ [TWITCH_SESSION_STORAGE_KEY]: session });
    return;
  }
  await chrome.storage.local.remove(TWITCH_SESSION_STORAGE_KEY).catch(() => undefined);
}

export function clearTwitchSessionCache(state: ServiceWorkerState) {
  state.twitchSessionCache = null;
  void persistTwitchSession(null);
}

export function trySanitizeSessionCandidate(candidate: unknown): TwitchSession | null {
  return sanitizeTwitchSession(candidate);
}

export function findSessionCandidateDeep(value: unknown, depth = 0): TwitchSession | null {
  if (depth > 4 || value == null) {
    return null;
  }

  const direct = trySanitizeSessionCandidate(value);
  if (direct) {
    return direct;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return findSessionCandidateDeep(parsed, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const session = findSessionCandidateDeep(item, depth + 1);
      if (session) {
        return session;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const session = findSessionCandidateDeep(nested, depth + 1);
      if (session) {
        return session;
      }
    }
  }

  return null;
}

export async function getTwitchCookieValue(name: string): Promise<string> {
  if (!chrome.cookies?.get) {
    return '';
  }

  const attempts = ['https://www.twitch.tv', 'https://twitch.tv', 'https://player.twitch.tv'];
  for (const url of attempts) {
    const cookie = await chrome.cookies.get({ url, name }).catch(() => null);
    const value = typeof cookie?.value === 'string' ? cookie.value.trim() : '';
    if (value) {
      return value;
    }
  }
  return '';
}

export async function recoverTwitchSessionFromCookies(): Promise<TwitchSession | null> {
  const [authToken, secureAuthToken, uniqueId, secureUniqueId, deviceIdCookie] = await Promise.all([
    getTwitchCookieValue('auth-token'),
    getTwitchCookieValue('__Secure-auth-token'),
    getTwitchCookieValue('unique_id'),
    getTwitchCookieValue('__Secure-unique_id'),
    getTwitchCookieValue('device_id'),
  ]);

  const candidate = trySanitizeSessionCandidate({
    oauthToken: authToken || secureAuthToken,
    deviceId: uniqueId || secureUniqueId || deviceIdCookie,
    uuid: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
  });

  if (!candidate) {
    return null;
  }

  logDebug('Recovered Twitch session from cookies', sessionDebugSummary(candidate));
  return candidate;
}

export async function recoverTwitchSessionFromStorageKeys(): Promise<TwitchSession | null> {
  const [localAll, syncAll] = await Promise.all([
    chrome.storage.local.get(null).catch(() => ({}) as Record<string, unknown>),
    chrome.storage.sync.get(null).catch(() => ({}) as Record<string, unknown>),
  ]);

  const local = localAll as Record<string, unknown>;
  const sync = syncAll as Record<string, unknown>;

  const directCandidate = trySanitizeSessionCandidate({
    oauthToken:
      local.oauthToken ??
      sync.oauthToken ??
      local.authToken ??
      sync.authToken ??
      local.accessToken ??
      sync.accessToken ??
      local.token ??
      sync.token,
    userId: local.userId ?? sync.userId ?? local.userID ?? sync.userID,
    deviceId:
      local.deviceId ??
      sync.deviceId ??
      local.local_copy_unique_id ??
      sync.local_copy_unique_id ??
      local.device_id ??
      sync.device_id,
    uuid:
      local.uuid ??
      sync.uuid ??
      local.clientSessionId ??
      sync.clientSessionId ??
      local['client-session-id'] ??
      sync['client-session-id'],
    clientIntegrity:
      local.clientIntegrity ?? sync.clientIntegrity ?? local['client-integrity'] ?? sync['client-integrity'],
    clientId: local.clientId ?? sync.clientId,
  });
  if (directCandidate) {
    logDebug('Recovered Twitch session from flat storage keys', sessionDebugSummary(directCandidate));
    return directCandidate;
  }

  const allEntries = [...Object.entries(local), ...Object.entries(sync)];
  for (const [key, value] of allEntries) {
    const session = findSessionCandidateDeep(value);
    if (session) {
      logDebug('Recovered Twitch session from storage entry', {
        key,
        ...sessionDebugSummary(session),
      });
      return session;
    }
  }

  logWarn('No Twitch session recovered from storage keys');
  return null;
}

export async function refreshTwitchIntegrityToken(
  state: ServiceWorkerState,
  session: TwitchSession,
): Promise<TwitchSession | null> {
  try {
    logDebug('Refreshing Twitch Client-Integrity token', {
      deviceIdSuffix: session.deviceId ? session.deviceId.slice(-6) : null,
      oauthTokenLength: session.oauthToken ? session.oauthToken.length : 0,
      hasPreviousIntegrity: Boolean(session.clientIntegrity),
    });
    const token = await fetchTwitchIntegrityToken(session);
    if (!token) {
      return null;
    }
    const updatedSession: TwitchSession = {
      ...session,
      clientIntegrity: token,
    };
    state.twitchSessionCache = updatedSession;
    await persistTwitchSession(updatedSession);
    logDebug('Twitch Client-Integrity token refreshed', {
      integrityLength: token.length,
      deviceIdSuffix: updatedSession.deviceId ? updatedSession.deviceId.slice(-6) : null,
    });
    return updatedSession;
  } catch (error) {
    logWarn('Unable to refresh Twitch Client-Integrity token', String(error));
    return null;
  }
}

export async function loadPageIntegrityToken(): Promise<string | null> {
  try {
    const stored = (await chrome.storage.local.get(['twitchIntegrity']).catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const integ = stored.twitchIntegrity as { token?: string; expiration?: number } | undefined;
    if (!integ || typeof integ.token !== 'string' || !integ.token) {
      return null;
    }
    if (typeof integ.expiration === 'number' && integ.expiration > 0 && integ.expiration < Date.now()) {
      logDebug('Page-intercepted integrity token has expired', { expiration: integ.expiration });
      return null;
    }
    return integ.token;
  } catch {
    return null;
  }
}

export async function ensureSessionIntegrity(
  state: ServiceWorkerState,
  session: TwitchSession,
  forceRefresh = false,
): Promise<TwitchSession> {
  if (!forceRefresh && session.clientIntegrity) {
    return session;
  }

  const pageToken = await loadPageIntegrityToken();
  if (pageToken && !forceRefresh) {
    logDebug('Using page-intercepted integrity token', { tokenLength: pageToken.length });
    const updated: TwitchSession = { ...session, clientIntegrity: pageToken };
    state.twitchSessionCache = updated;
    await persistTwitchSession(updated);
    return updated;
  }

  const refreshed = await refreshTwitchIntegrityToken(state, session);
  return refreshed ?? session;
}

export async function readTwitchSessionViaExecuteScript(tabId: number): Promise<TwitchSession | null> {
  try {
    const execution = await chrome.scripting.executeScript({
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
          const stores: Storage[] = [window.localStorage, window.sessionStorage];
          for (const store of stores) {
            for (const key of keys) {
              const raw = store.getItem(key);
              if (!raw) {
                continue;
              }
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
                if (oauthToken || userId) {
                  return { oauthToken, userId };
                }
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
        const userId = twilight.userId || '';
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

        if (!oauthToken || !deviceId) {
          return null;
        }

        return {
          oauthToken,
          userId,
          deviceId,
          uuid,
          clientIntegrity: clientIntegrity || undefined,
        };
      },
    });
    const raw = execution[0]?.result;
    const session = sanitizeTwitchSession(raw as unknown);
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

export interface EnsureTwitchSessionCallbacks {
  onFindTwitchSessionInOpenTabs: () => Promise<TwitchSession | null>;
  onStopFarmingSession?: (options: {
    notification?: { title: string; message: string };
    stopReason?: string;
    stopMessage?: string | null;
  }) => Promise<void>;
}

export interface EnsureTwitchSessionDeps {
  sanitizeTwitchSession: (raw: unknown) => TwitchSession | null;
  sessionDebugSummary: (session: TwitchSession | null) => Record<string, unknown>;
  persistTwitchSession: (session: TwitchSession | null) => Promise<void>;
  clearTwitchSessionCache: (state: ServiceWorkerState) => void;
}

export async function ensureTwitchSession(
  state: ServiceWorkerState,
  forceRefresh = false,
  callbacks: EnsureTwitchSessionCallbacks,
  deps: EnsureTwitchSessionDeps,
): Promise<TwitchSession | null> {
  const TWITCH_SESSION_RETRY_COOLDOWN_MS = 5_000;

  if (!forceRefresh && state.twitchSessionCache) {
    return state.twitchSessionCache;
  }

  const now = Date.now();
  if (!forceRefresh && now - state.twitchSessionLastAttemptAt < TWITCH_SESSION_RETRY_COOLDOWN_MS) {
    return null;
  }

  if (state.twitchSessionFetchInFlight) {
    return state.twitchSessionFetchInFlight;
  }

  state.twitchSessionFetchInFlight = (async () => {
    state.twitchSessionLastAttemptAt = Date.now();
    if (!forceRefresh) {
      const storageResult = (await chrome.storage.local.get(['twitchSession']).catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const fromStorageRaw = storageResult.twitchSession;
      const fromStorage = deps.sanitizeTwitchSession(fromStorageRaw as unknown);
      if (fromStorage) {
        state.twitchSessionCache = fromStorage;
        return fromStorage;
      }

      const recoveredSession = await recoverTwitchSessionFromStorageKeys();
      if (recoveredSession) {
        state.twitchSessionCache = recoveredSession;
        await deps.persistTwitchSession(recoveredSession);
        state.twitchSessionLastAttemptAt = Date.now();
        return recoveredSession;
      }
    }

    const fromCookies = await recoverTwitchSessionFromCookies();
    if (fromCookies) {
      state.twitchSessionCache = fromCookies;
      await deps.persistTwitchSession(fromCookies);
      state.twitchSessionLastAttemptAt = Date.now();
      return fromCookies;
    }

    const fromOpenTabs = await callbacks.onFindTwitchSessionInOpenTabs();
    if (fromOpenTabs) {
      state.twitchSessionCache = fromOpenTabs;
      await deps.persistTwitchSession(fromOpenTabs);
      state.twitchSessionLastAttemptAt = Date.now();
      return fromOpenTabs;
    }

    deps.clearTwitchSessionCache(state);
    return null;
  })().finally(() => {
    state.twitchSessionFetchInFlight = null;
  });

  return state.twitchSessionFetchInFlight;
}
