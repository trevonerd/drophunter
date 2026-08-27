import type { DropsSnapshot } from '../types';
import { applyApiBackoff, clearSignInRequiredStop, fetchDropsSnapshotFromApi } from './api-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import type { TwitchSession } from './twitch-api/types.ts';

export interface FetchDropsSnapshotFromApiCallbacks {
  onEnsureTwitchSession: (forceRefresh?: boolean) => Promise<TwitchSession | null>;
  onRecoverTwitchSessionAfterAuthError?: () => Promise<TwitchSession | null>;
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

const SIGN_IN_REQUIRED_MESSAGE =
  'DropHunter could not refresh your Twitch session. Please open Twitch and sign in.';

export async function stopForSignInRequiredIfRunning(
  state: ServiceWorkerState,
  callback?: FetchDropsSnapshotFromApiCallbacks['onStopFarmingSession'],
) {
  if (!state.appState.isRunning || !callback) return;
  await callback({
    notification: { title: 'Sign-in required', message: SIGN_IN_REQUIRED_MESSAGE },
    stopReason: 'sign-in-required',
    stopMessage: SIGN_IN_REQUIRED_MESSAGE,
  });
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
  authRecoveryAttempted = false,
  recoveredSession: TwitchSession | null = null,
): Promise<DropsSnapshot | null> {
  let session = recoveredSession ?? (await callbacks.onEnsureTwitchSession(forceSessionRefresh));
  if (!session) {
    deps.logWarn('Drops snapshot API skipped: Twitch session missing');
    if (forceSessionRefresh) await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
    return null;
  }
  if (!session.userId) {
    deps.logWarn('Twitch session has no userId — attempting auto-detect', deps.sessionDebugSummary(session));
    let transientFailure = false;
    try {
      const sessionForDetect = await callbacks.onEnsureSessionIntegrity(state, session);
      const detectedId = await new deps.TwitchApiClient(sessionForDetect).fetchCurrentUserId();
      if (detectedId) {
        deps.logInfo('Auto-detected Twitch userId', { userId: detectedId });
        session = { ...session, userId: detectedId, clientIntegrity: sessionForDetect.clientIntegrity };
        state.twitchSessionCache = session;
        await callbacks.onPersistTwitchSession(session);
        clearSignInRequiredStop(state);
      } else deps.logWarn('Could not auto-detect userId — user may not be logged in');
    } catch (error) {
      if (callbacks.onIsLikelyAuthError(error)) {
        deps.logWarn('Failed to auto-detect userId: auth error', String(error));
        callbacks.onClearTwitchSessionCache(state);
        if (!authRecoveryAttempted && callbacks.onRecoverTwitchSessionAfterAuthError) {
          const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError();
          if (recovered)
            return fetchDropsSnapshotFromApiWrapper(state, false, callbacks, deps, options, true, recovered);
        }
      } else {
        deps.logWarn('Failed to auto-detect userId: transient error, will retry', String(error));
        transientFailure = true;
        applyApiBackoff(state);
      }
    }
    if (!session.userId && transientFailure) return null;
    if (!session.userId && state.appState.isRunning) {
      await callbacks.onStopFarmingSession?.({
        notification: {
          title: 'Sign-in required',
          message: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
        },
        stopReason: 'sign-in-required',
        stopMessage: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
      });
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
      if (!authRecoveryAttempted && callbacks.onRecoverTwitchSessionAfterAuthError) {
        const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError();
        if (recovered)
          return fetchDropsSnapshotFromApiWrapper(state, false, callbacks, deps, options, true, recovered);
      }
      deps.logWarn('Twitch API auth failed after explicit session recovery:', String(error));
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
