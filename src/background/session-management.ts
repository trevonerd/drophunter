import { browser } from '../shared/browser-api.ts';
import { clearTerminalStopStatus } from '../shared/runtime-status.ts';
import { TWITCH_SESSION_RETRY_COOLDOWN_MS, TWITCH_SESSION_STORAGE_KEY } from './constants.ts';
import { logDebug, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { recoverTwitchSessionFromStorageKeys } from './session-storage-recovery.ts';
import { sessionDebugSummary } from './state-persistence.ts';
import { fetchTwitchIntegrityToken } from './twitch-api/gql.ts';
import { sanitizeTwitchSession, type TwitchSession } from './twitch-api/types.ts';

export { readTwitchSessionViaExecuteScript } from './session-page-extraction.ts';
export {
  findSessionCandidateDeep,
  recoverTwitchSessionFromStorageKeys,
  trySanitizeSessionCandidate,
} from './session-storage-recovery.ts';

export async function persistTwitchSession(session: TwitchSession | null) {
  if (session) {
    await browser.storage.local.set({ [TWITCH_SESSION_STORAGE_KEY]: session });
    return;
  }
  await browser.storage.local.remove(TWITCH_SESSION_STORAGE_KEY).catch(() => undefined);
}

export function clearTwitchSessionCache(state: ServiceWorkerState) {
  state.twitchSessionCache = null;
  void persistTwitchSession(null);
}

export async function refreshTwitchIntegrityToken(
  state: ServiceWorkerState,
  session: TwitchSession,
): Promise<TwitchSession | null> {
  try {
    logDebug('Refreshing Twitch Client-Integrity token', {
      hasDeviceId: Boolean(session.deviceId),
      hasOAuthToken: Boolean(session.oauthToken),
      hasPreviousIntegrity: Boolean(session.clientIntegrity),
    });
    const token = await fetchTwitchIntegrityToken(session);
    if (!token) return null;
    const updatedSession: TwitchSession = { ...session, clientIntegrity: token };
    state.twitchSessionCache = updatedSession;
    await persistTwitchSession(updatedSession);
    logDebug('Twitch Client-Integrity token refreshed', {
      hasIntegrity: Boolean(token),
      hasDeviceId: Boolean(updatedSession.deviceId),
    });
    return updatedSession;
  } catch (error) {
    logWarn('Unable to refresh Twitch Client-Integrity token', String(error));
    return null;
  }
}

export async function loadPageIntegrityToken(): Promise<string | null> {
  try {
    const stored: Record<string, unknown> = await browser.storage.local
      .get(['twitchIntegrity'])
      .catch(() => ({}));
    const integ = stored.twitchIntegrity;
    if (!integ || typeof integ !== 'object') return null;
    const record = integ as Record<string, unknown>;
    if (typeof record.token !== 'string' || !record.token) return null;
    if (typeof record.expiration === 'number' && record.expiration > 0 && record.expiration < Date.now()) {
      logDebug('Page-intercepted integrity token has expired', { expiration: record.expiration });
      return null;
    }
    return record.token;
  } catch {
    return null;
  }
}

export async function ensureSessionIntegrity(
  state: ServiceWorkerState,
  session: TwitchSession,
  forceRefresh = false,
): Promise<TwitchSession> {
  if (!forceRefresh && session.clientIntegrity) return session;
  const pageToken = await loadPageIntegrityToken();
  if (pageToken && !forceRefresh) {
    logDebug('Using page-intercepted integrity token', { hasToken: true });
    const updated: TwitchSession = { ...session, clientIntegrity: pageToken };
    state.twitchSessionCache = updated;
    await persistTwitchSession(updated);
    return updated;
  }
  return (await refreshTwitchIntegrityToken(state, session)) ?? session;
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
  const sessionAtStart = state.twitchSessionCache;
  if (!forceRefresh && state.twitchSessionCache) return state.twitchSessionCache;
  if (!forceRefresh && Date.now() - state.twitchSessionLastAttemptAt < TWITCH_SESSION_RETRY_COOLDOWN_MS)
    return null;
  if (state.twitchSessionFetchInFlight) return state.twitchSessionFetchInFlight;
  state.twitchSessionFetchInFlight = (async () => {
    state.twitchSessionLastAttemptAt = Date.now();
    if (!forceRefresh) {
      const result: Record<string, unknown> = await browser.storage.local
        .get(['twitchSession'])
        .catch(() => ({}));
      const fromStorage = deps.sanitizeTwitchSession(result.twitchSession);
      if (fromStorage) {
        state.twitchSessionCache = fromStorage;
        return fromStorage;
      }
      const recovered = await recoverTwitchSessionFromStorageKeys();
      if (recovered) {
        state.twitchSessionCache = recovered;
        await deps.persistTwitchSession(recovered);
        state.twitchSessionLastAttemptAt = Date.now();
        return recovered;
      }
    }
    const fromOpenTabs = await callbacks.onFindTwitchSessionInOpenTabs();
    if (fromOpenTabs) {
      state.twitchSessionCache = fromOpenTabs;
      await deps.persistTwitchSession(fromOpenTabs);
      state.twitchSessionLastAttemptAt = Date.now();
      return fromOpenTabs;
    }
    if (state.twitchSessionCache && state.twitchSessionCache !== sessionAtStart)
      return state.twitchSessionCache;
    deps.clearTwitchSessionCache(state);
    return null;
  })()
    .then((session) => {
      if (session && !state.appState.twitchSessionDetected) state.appState.twitchSessionDetected = true;
      return session;
    })
    .finally(() => {
      state.twitchSessionFetchInFlight = null;
    });
  return state.twitchSessionFetchInFlight;
}

export interface SyncTwitchSessionCallbacks {
  shouldRefreshCampaignsAfterSessionSync: () => boolean;
  onRefreshCampaigns: () => Promise<unknown>;
  onSaveState: () => Promise<void>;
  onBroadcastStateUpdate: () => void;
}

export async function syncTwitchSessionFromContentScriptExt(
  state: ServiceWorkerState,
  rawPayload: unknown,
  senderTabId: number | null | undefined,
  callbacks: SyncTwitchSessionCallbacks,
): Promise<{ success: boolean; error?: string }> {
  const incoming = sanitizeTwitchSession(rawPayload);
  if (!incoming) return { success: false, error: 'Invalid session payload' };
  state.twitchSessionCache = incoming;
  state.twitchSessionLastAttemptAt = 0;
  state.appState.twitchSessionDetected = true;
  const hadStaleSignInStop = state.appState.lastStopReason === 'sign-in-required';
  if (hadStaleSignInStop) state.appState = clearTerminalStopStatus(state.appState);
  await persistTwitchSession(incoming);
  logDebug('Twitch session synced from content script', sessionDebugSummary(incoming));
  if (senderTabId && callbacks.shouldRefreshCampaignsAfterSessionSync()) {
    await callbacks.onRefreshCampaigns();
    await callbacks.onSaveState();
    callbacks.onBroadcastStateUpdate();
  } else if (hadStaleSignInStop) {
    await callbacks.onSaveState();
    callbacks.onBroadcastStateUpdate();
  }
  return { success: true };
}

export interface SyncTwitchIntegrityPayload {
  token?: string;
  expiration?: number;
  request_id?: string;
}
export async function syncTwitchIntegrityFromContentScriptExt(
  state: ServiceWorkerState,
  payload: SyncTwitchIntegrityPayload | undefined,
): Promise<{ success: boolean; error?: string }> {
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
  if (!token) return { success: false, error: 'Empty integrity token' };
  const expiration = typeof payload?.expiration === 'number' ? payload.expiration : 0;
  logDebug('Integrity token synced from content script', {
    hasToken: true,
    expiration,
    hasSession: Boolean(state.twitchSessionCache),
  });
  state.integrityFallbackActive = false;
  state.integrityFallbackActiveUntil = 0;
  if (state.twitchSessionCache) {
    state.twitchSessionCache = { ...state.twitchSessionCache, clientIntegrity: token };
    persistTwitchSession(state.twitchSessionCache).catch(() => undefined);
  }
  browser.storage.local
    .set({
      twitchIntegrity: { token, expiration, request_id: payload?.request_id || '' },
    })
    .catch(() => undefined);
  return { success: true };
}
