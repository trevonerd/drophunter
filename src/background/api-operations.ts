import { clearTerminalStopStatus } from '../shared/runtime-status.ts';
import { toSlug } from '../shared/utils.ts';
import { DropsSnapshot, TwitchGame, TwitchStreamer } from '../types';
import { INTEGRITY_FALLBACK_TTL_MS, PROGRESS_POLL_MS } from './constants.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './service-worker.ts';
import {
  clearTwitchSessionCache as clearTwitchSessionCacheExt,
  ensureSessionIntegrity as ensureSessionIntegrityExt,
} from './session-management.ts';
import { type FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import { isLikelyAuthError, TwitchSession } from './twitch-api/types.ts';

function applyApiBackoff(state: ServiceWorkerState) {
  state.apiConsecutiveFailures += 1;
  state.apiBackoffUntil =
    Date.now() + Math.min(2 ** state.apiConsecutiveFailures * PROGRESS_POLL_MS, 10 * 60_000);
}

// A successful authorized API call proves the Twitch session is valid, so any
// stale 'sign-in-required' terminal stop from a prior transient failure no
// longer applies — clear it instead of leaving the popup banner stuck forever.
function clearSignInRequiredStop(state: ServiceWorkerState) {
  if (state.appState.lastStopReason === 'sign-in-required') {
    state.appState = clearTerminalStopStatus(state.appState);
  }
}

// Shared by fetchDropsSnapshotFromApi and fetchInventorySnapshotFromApi: both hit the
// same "integrity token rejected" failure mode and recover the same way — refresh the
// integrity token and retry once, then fall back to no-integrity mode for a TTL window.
async function fetchSnapshotWithIntegrityRetry(
  state: ServiceWorkerState,
  session: TwitchSession,
  fetchSnapshot: (client: TwitchApiClient) => Promise<DropsSnapshot>,
): Promise<DropsSnapshot | null> {
  const sessionWithIntegrity =
    state.integrityFallbackActive && Date.now() < state.integrityFallbackActiveUntil
      ? { ...session, clientIntegrity: undefined }
      : await ensureSessionIntegrityExt(state, session);

  try {
    const snapshot = await fetchSnapshot(new TwitchApiClient(sessionWithIntegrity));
    state.apiConsecutiveFailures = 0;
    state.apiBackoffUntil = 0;
    clearSignInRequiredStop(state);
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
          const retriedSnapshot = await fetchSnapshot(new TwitchApiClient(refreshedIntegritySession));
          state.apiConsecutiveFailures = 0;
          state.apiBackoffUntil = 0;
          clearSignInRequiredStop(state);
          return retriedSnapshot;
        } catch (retryError) {
          logDebug('Integrity-refreshed retry still failed, falling back to no-integrity mode', {
            error: String(retryError),
          });
        }
      }

      try {
        const sessionWithoutIntegrity: TwitchSession = { ...session, clientIntegrity: undefined };
        const fallbackSnapshot = await fetchSnapshot(new TwitchApiClient(sessionWithoutIntegrity));
        state.integrityFallbackActive = true;
        state.integrityFallbackActiveUntil = Date.now() + INTEGRITY_FALLBACK_TTL_MS;
        state.apiConsecutiveFailures = 0;
        state.apiBackoffUntil = 0;
        clearSignInRequiredStop(state);
        return fallbackSnapshot;
      } catch (fallbackError) {
        logDebug('No-integrity fallback fetch also failed', { error: String(fallbackError) });
      }
    }
    if (isLikelyAuthError(error)) {
      throw error;
    }
    applyApiBackoff(state);
    return null;
  }
}

export async function fetchDropsSnapshotFromApi(
  state: ServiceWorkerState,
  session: TwitchSession,
  options: FetchDropsSnapshotOptions = {},
): Promise<DropsSnapshot | null> {
  return fetchSnapshotWithIntegrityRetry(state, session, (client) => client.fetchDropsSnapshot(options));
}

export async function fetchInventorySnapshotFromApi(
  state: ServiceWorkerState,
  session: TwitchSession,
  baseDrops: DropsSnapshot['drops'],
): Promise<DropsSnapshot | null> {
  if (baseDrops.length === 0) {
    return null;
  }

  const snapshot = await fetchSnapshotWithIntegrityRetry(state, session, (client) =>
    client.fetchInventorySnapshot(baseDrops),
  );
  return snapshot && snapshot.drops.length > 0 ? snapshot : null;
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

export interface FetchInventorySnapshotFromApiCallbacks {
  onEnsureTwitchSession: (forceRefresh?: boolean) => Promise<TwitchSession | null>;
  onIsLikelyAuthError: (error: unknown) => boolean;
  onClearTwitchSessionCache: (state: ServiceWorkerState) => void;
  onStopFarmingSession?: (options: {
    notification?: { title: string; message: string };
    stopReason?: string;
    stopMessage?: string | null;
  }) => Promise<void>;
}

const SIGN_IN_REQUIRED_MESSAGE =
  'DropHunter could not refresh your Twitch session. Please open Twitch and sign in.';

async function stopForSignInRequiredIfRunning(
  state: ServiceWorkerState,
  callback?: FetchDropsSnapshotFromApiCallbacks['onStopFarmingSession'],
) {
  if (!state.appState.isRunning || !callback) {
    return;
  }
  await callback({
    notification: {
      title: 'Sign-in required',
      message: SIGN_IN_REQUIRED_MESSAGE,
    },
    stopReason: 'sign-in-required',
    stopMessage: SIGN_IN_REQUIRED_MESSAGE,
  });
}

export async function fetchInventorySnapshotFromApiWrapper(
  state: ServiceWorkerState,
  baseDrops: DropsSnapshot['drops'],
  forceSessionRefresh: boolean,
  callbacks: FetchInventorySnapshotFromApiCallbacks,
  deps: {
    logWarn: (msg: string, ctx?: unknown) => void;
  },
): Promise<DropsSnapshot | null> {
  const session = await callbacks.onEnsureTwitchSession(forceSessionRefresh);
  if (!session) {
    deps.logWarn('Inventory snapshot API skipped: Twitch session missing');
    if (forceSessionRefresh) {
      await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
    }
    return null;
  }

  try {
    return await fetchInventorySnapshotFromApi(state, session, baseDrops);
  } catch (error) {
    if (callbacks.onIsLikelyAuthError(error)) {
      callbacks.onClearTwitchSessionCache(state);
      if (!forceSessionRefresh) {
        return fetchInventorySnapshotFromApiWrapper(state, baseDrops, true, callbacks, deps);
      }
      deps.logWarn('Twitch inventory auth failed after forced session refresh:', String(error));
      await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
      return null;
    }
    deps.logWarn('Twitch inventory snapshot fetch failed:', String(error));
    return null;
  }
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
  options: FetchDropsSnapshotOptions = {},
): Promise<DropsSnapshot | null> {
  let session = await callbacks.onEnsureTwitchSession(forceSessionRefresh);
  if (!session) {
    deps.logWarn('Drops snapshot API skipped: Twitch session missing');
    if (forceSessionRefresh) {
      await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
    }
    return null;
  }
  if (!session.userId) {
    deps.logWarn('Twitch session has no userId — attempting auto-detect', deps.sessionDebugSummary(session));
    let autoDetectFailedTransiently = false;
    try {
      const sessionForDetect = await callbacks.onEnsureSessionIntegrity(state, session);
      const detectClient = new deps.TwitchApiClient(sessionForDetect);
      const detectedId = await detectClient.fetchCurrentUserId();
      if (detectedId) {
        deps.logInfo('Auto-detected Twitch userId', { userId: detectedId });
        session = { ...session, userId: detectedId, clientIntegrity: sessionForDetect.clientIntegrity };
        state.twitchSessionCache = session;
        await callbacks.onPersistTwitchSession(session);
        clearSignInRequiredStop(state);
      } else {
        deps.logWarn('Could not auto-detect userId — user may not be logged in');
      }
    } catch (error) {
      if (callbacks.onIsLikelyAuthError(error)) {
        deps.logWarn('Failed to auto-detect userId: auth error', String(error));
      } else {
        // Network/timeout/integrity hiccup, not proof the user is signed out —
        // don't trigger a terminal sign-in-required stop for a transient failure.
        deps.logWarn('Failed to auto-detect userId: transient error, will retry', String(error));
        autoDetectFailedTransiently = true;
        applyApiBackoff(state);
      }
    }
    if (!session.userId && autoDetectFailedTransiently) {
      return null;
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
    return await fetchDropsSnapshotFromApi(state, session, options);
  } catch (error) {
    if (callbacks.onIsLikelyAuthError(error)) {
      callbacks.onClearTwitchSessionCache(state);
      if (!forceSessionRefresh) {
        return fetchDropsSnapshotFromApiWrapper(state, true, callbacks, deps, options);
      }
      deps.logWarn('Twitch API auth failed after forced session refresh:', String(error));
      await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
      return null;
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
