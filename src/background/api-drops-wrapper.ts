import type { DropsSnapshot } from '../types';
import { applyApiBackoff, clearSignInRequiredStop, fetchDropsSnapshotFromApi } from './api-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { SessionRecoveryMode, TwitchApiRequestOptions } from './session-orchestrator.ts';
import type { FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import type { TwitchSession } from './twitch-api/types.ts';
import { markTwitchSessionBlocked, markTwitchSessionRetrying } from './twitch-session-sync.ts';

export interface FetchDropsSnapshotFromApiCallbacks {
  onEnsureTwitchSession: () => Promise<TwitchSession | null>;
  onRecoverTwitchSessionAfterAuthError?: (mode: SessionRecoveryMode) => Promise<TwitchSession | null>;
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
  markTwitchSessionBlocked(state, state.apiConsecutiveFailures);
  if (!state.appState.isRunning || !callback) return;
  await callback({
    notification: { title: 'Sign-in required', message: SIGN_IN_REQUIRED_MESSAGE },
    stopReason: 'sign-in-required',
    stopMessage: SIGN_IN_REQUIRED_MESSAGE,
  });
}

export async function fetchDropsSnapshotFromApiWrapper(
  state: ServiceWorkerState,
  requestOptions: TwitchApiRequestOptions,
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
  const recoveryMode = requestOptions.sessionRecoveryMode ?? 'passive';
  let session = recoveredSession ?? (await callbacks.onEnsureTwitchSession());
  if (!session) {
    deps.logWarn('Drops snapshot API skipped: Twitch session missing');
    if (recoveryMode === 'background-tab' && !authRecoveryAttempted) {
      const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError?.(recoveryMode);
      if (recovered) {
        return fetchDropsSnapshotFromApiWrapper(
          state,
          requestOptions,
          callbacks,
          deps,
          options,
          true,
          recovered,
        );
      }
    }
    if (state.appState.isRunning) {
      applyApiBackoff(state);
      markTwitchSessionRetrying(state, state.apiBackoffUntil, state.apiConsecutiveFailures);
    }
    return null;
  }
  if (!session.userId) {
    deps.logWarn('Twitch session has no userId — attempting auto-detect', deps.sessionDebugSummary(session));
    let transientFailure = false;
    let explicitAuthFailure = false;
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
        explicitAuthFailure = true;
        deps.logWarn('Failed to auto-detect userId: auth error', String(error));
        callbacks.onClearTwitchSessionCache(state);
        if (!authRecoveryAttempted && callbacks.onRecoverTwitchSessionAfterAuthError) {
          const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError(recoveryMode);
          if (recovered)
            return fetchDropsSnapshotFromApiWrapper(
              state,
              requestOptions,
              callbacks,
              deps,
              options,
              true,
              recovered,
            );
        }
      } else {
        deps.logWarn('Failed to auto-detect userId: transient error, will retry', String(error));
        transientFailure = true;
        applyApiBackoff(state);
      }
    }
    if (!session.userId && transientFailure) return null;
    if (!session.userId) {
      if (state.appState.isRunning && explicitAuthFailure) {
        await callbacks.onStopFarmingSession?.({
          notification: {
            title: 'Sign-in required',
            message: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
          },
          stopReason: 'sign-in-required',
          stopMessage: 'DropHunter could not detect your Twitch account. Please open Twitch and sign in.',
        });
      } else {
        applyApiBackoff(state);
        if (state.appState.isRunning) {
          markTwitchSessionRetrying(state, state.apiBackoffUntil, state.apiConsecutiveFailures);
        }
      }
      return null;
    }
  }

  deps.logDebug('Fetching drops snapshot via API', {
    recoveryMode,
    ...deps.sessionDebugSummary(session),
  });
  try {
    return await fetchDropsSnapshotFromApi(state, session, options);
  } catch (error) {
    if (callbacks.onIsLikelyAuthError(error)) {
      callbacks.onClearTwitchSessionCache(state);
      if (!authRecoveryAttempted && callbacks.onRecoverTwitchSessionAfterAuthError) {
        const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError(recoveryMode);
        if (recovered)
          return fetchDropsSnapshotFromApiWrapper(
            state,
            requestOptions,
            callbacks,
            deps,
            options,
            true,
            recovered,
          );
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
