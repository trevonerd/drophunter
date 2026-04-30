import { toSlug } from '../shared/utils.ts';
import { DropsSnapshot, TwitchGame, TwitchStreamer } from '../types';
import { PROGRESS_POLL_MS } from './constants.ts';
import type { ServiceWorkerState } from './service-worker.ts';
import {
  clearTwitchSessionCache as clearTwitchSessionCacheExt,
  ensureSessionIntegrity as ensureSessionIntegrityExt,
} from './session-management.ts';
import { TwitchApiClient } from './twitch-api/client.ts';
import { isLikelyAuthError, TwitchSession } from './twitch-api/types.ts';

export async function fetchDropsSnapshotFromApi(
  state: ServiceWorkerState,
  session: TwitchSession,
): Promise<DropsSnapshot | null> {
  const sessionWithIntegrity =
    state.integrityFallbackActive && Date.now() < state.integrityFallbackActiveUntil
      ? { ...session, clientIntegrity: undefined }
      : await ensureSessionIntegrityExt(state, session);

  let client = new TwitchApiClient(sessionWithIntegrity);
  try {
    const snapshot = await client.fetchDropsSnapshot();
    if (snapshot.games.length === 0 && snapshot.drops.length === 0) {
      return null;
    }
    state.apiConsecutiveFailures = 0;
    state.apiBackoffUntil = 0;
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('integrity')) {
      const refreshedIntegritySession = await ensureSessionIntegrityExt(state, session, true);
      if (
        refreshedIntegritySession.clientIntegrity &&
        refreshedIntegritySession.clientIntegrity !== sessionWithIntegrity.clientIntegrity
      ) {
        try {
          client = new TwitchApiClient(refreshedIntegritySession);
          const retriedSnapshot = await client.fetchDropsSnapshot();
          if (retriedSnapshot.games.length === 0 && retriedSnapshot.drops.length === 0) {
            return null;
          }
          state.apiConsecutiveFailures = 0;
          state.apiBackoffUntil = 0;
          return retriedSnapshot;
        } catch {}
      }

      try {
        const sessionWithoutIntegrity: TwitchSession = { ...session, clientIntegrity: undefined };
        client = new TwitchApiClient(sessionWithoutIntegrity);
        const fallbackSnapshot = await client.fetchDropsSnapshot();
        if (fallbackSnapshot.games.length === 0 && fallbackSnapshot.drops.length === 0) {
          return null;
        }
        state.integrityFallbackActive = true;
        state.integrityFallbackActiveUntil = Date.now() + 30 * 60_000;
        state.apiConsecutiveFailures = 0;
        state.apiBackoffUntil = 0;
        return fallbackSnapshot;
      } catch {}
    }
    state.apiConsecutiveFailures += 1;
    state.apiBackoffUntil =
      Date.now() + Math.min(2 ** state.apiConsecutiveFailures * PROGRESS_POLL_MS, 10 * 60_000);
    return null;
  }
}

export async function fetchDirectoryStreamersFromApi(
  state: ServiceWorkerState,
  game: TwitchGame,
  session: TwitchSession | null,
  language = '',
): Promise<TwitchStreamer[] & { languageFilterApplied: boolean }> {
  const client = new TwitchApiClient(
    session ?? {
      oauthToken: 'public',
      userId: 'public',
      deviceId: 'public',
      uuid: 'public',
    },
  );
  try {
    const slug = game.categorySlug ?? toSlug(game.name);
    const streamers = await client.fetchDirectoryStreamers(game.name, slug, language);
    return streamers;
  } catch (error) {
    if (session && isLikelyAuthError(error)) {
      clearTwitchSessionCacheExt(state);
    }
    return Object.assign([], { languageFilterApplied: false });
  }
}

export interface FetchDropsSnapshotFromApiCallbacks {
  onEnsureTwitchSession: (forceRefresh?: boolean) => Promise<TwitchSession | null>;
  onEnsureSessionIntegrity: (
    state: ServiceWorkerState,
    session: TwitchSession,
    forceRefresh?: boolean,
  ) => Promise<TwitchSession>;
  onPersistTwitchSession: (session: TwitchSession | null) => Promise<void>;
  onStopFarmingSession?: (options: {
    notification?: { title: string; message: string };
    stopReason?: string;
    stopMessage?: string | null;
  }) => Promise<void>;
  onIsLikelyAuthError: (error: unknown) => boolean;
  onClearTwitchSessionCache: (state: ServiceWorkerState) => void;
}

export async function fetchDropsSnapshotFromApiWrapper(
  state: ServiceWorkerState,
  forceSessionRefresh: boolean,
  callbacks: FetchDropsSnapshotFromApiCallbacks,
  deps: {
    TwitchApiClient: typeof TwitchApiClient;
    sessionDebugSummary: (session: TwitchSession | null) => Record<string, unknown>;
    PROGRESS_POLL_MS: number;
    logDebug: (msg: string, ctx?: unknown) => void;
    logWarn: (msg: string, ctx?: unknown) => void;
    logInfo: (msg: string, ctx?: unknown) => void;
  },
): Promise<DropsSnapshot | null> {
  let session = await callbacks.onEnsureTwitchSession(forceSessionRefresh);
  if (!session) {
    deps.logWarn('Drops snapshot API skipped: Twitch session missing');
    return null;
  }
  if (!session.userId) {
    deps.logWarn('Twitch session has no userId — attempting auto-detect', deps.sessionDebugSummary(session));
    try {
      const sessionForDetect = await callbacks.onEnsureSessionIntegrity(state, session);
      const detectClient = new deps.TwitchApiClient(sessionForDetect);
      const detectedId = await detectClient.fetchCurrentUserId();
      if (detectedId) {
        deps.logInfo('Auto-detected Twitch userId', { userId: detectedId });
        session = { ...session, userId: detectedId, clientIntegrity: sessionForDetect.clientIntegrity };
        state.twitchSessionCache = session;
        await callbacks.onPersistTwitchSession(session);
      } else {
        deps.logWarn('Could not auto-detect userId — user may not be logged in');
      }
    } catch (error) {
      deps.logWarn('Failed to auto-detect userId', String(error));
    }
    if (!session.userId && state.appState.isRunning) {
      if (callbacks.onStopFarmingSession) {
        await callbacks.onStopFarmingSession({
          notification: {
            title: 'Sign-in required',
            message: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
          },
          stopReason: 'sign-in-required',
          stopMessage: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
        });
      }
      return null;
    }
  }

  deps.logDebug('Fetching drops snapshot via API', {
    forceSessionRefresh,
    ...deps.sessionDebugSummary(session),
  });

  try {
    return await fetchDropsSnapshotFromApi(state, session);
  } catch (error) {
    if (callbacks.onIsLikelyAuthError(error)) {
      callbacks.onClearTwitchSessionCache(state);
      if (!forceSessionRefresh) {
        return fetchDropsSnapshotFromApiWrapper(state, true, callbacks, deps);
      }
    }
    deps.logWarn('Twitch API snapshot fetch failed:', String(error));
    state.apiConsecutiveFailures += 1;
    state.apiBackoffUntil =
      Date.now() + Math.min(2 ** state.apiConsecutiveFailures * deps.PROGRESS_POLL_MS, 10 * 60_000);
    deps.logDebug('API backoff scheduled', {
      consecutiveFailures: state.apiConsecutiveFailures,
      backoffMs: state.apiBackoffUntil - Date.now(),
    });
    return null;
  }
}

export interface FetchDirectoryStreamersFromApiCallbacks {
  onEnsureTwitchSession: (forceRefresh?: boolean) => Promise<TwitchSession | null>;
  onIsLikelyAuthError: (error: unknown) => boolean;
  onClearTwitchSessionCache: (state: ServiceWorkerState) => void;
}

export async function fetchDirectoryStreamersFromApiWrapper(
  state: ServiceWorkerState,
  game: TwitchGame,
  forceSessionRefresh: boolean,
  language: string,
  callbacks: FetchDirectoryStreamersFromApiCallbacks,
  deps: {
    logWarn: (msg: string, ctx?: unknown) => void;
  },
): Promise<TwitchStreamer[] & { languageFilterApplied: boolean }> {
  const session = await callbacks.onEnsureTwitchSession(forceSessionRefresh);
  if (!session) {
    deps.logWarn('Directory streamers fetch: session missing, using public client');
  }

  try {
    return await fetchDirectoryStreamersFromApi(state, game, session, language);
  } catch (error) {
    if (session && callbacks.onIsLikelyAuthError(error)) {
      callbacks.onClearTwitchSessionCache(state);
      if (!forceSessionRefresh) {
        return fetchDirectoryStreamersFromApiWrapper(state, game, true, language, callbacks, deps);
      }
    }
    deps.logWarn('Twitch API directory fetch failed:', String(error));
    return Object.assign([], { languageFilterApplied: false });
  }
}
