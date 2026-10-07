import type { DropsSnapshot } from '../types';
import { applyApiBackoff, clearSignInRequiredStop, fetchDropsSnapshotFromApi } from './api-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { bindCampaignEvidenceAccount } from './session-account-evidence.ts';
import { currentTwitchSessionRevision } from './session-management.ts';
import type { SessionRecoveryMode, TwitchApiRequestOptions } from './session-orchestrator.ts';
import type { FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import type { TwitchSession } from './twitch-api/types.ts';
import { markTwitchSessionRetrying } from './twitch-session-sync.ts';

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
  onClearTwitchSessionCache: (state: ServiceWorkerState) => Promise<void> | void;
}

const SIGN_IN_REQUIRED_MESSAGE =
  'DropHunter could not refresh your Twitch session. Please open Twitch and sign in.';

export async function stopForSignInRequiredIfRunning(
  state: ServiceWorkerState,
  callback?: FetchDropsSnapshotFromApiCallbacks['onStopFarmingSession'],
) {
  if (!state.appState.isRunning || state.appState.isPaused || state.appState.lastStopReason === 'user-stop')
    return;
  if (
    state.appState.twitchSessionSyncState.status === 'retrying' &&
    !state.appState.activeStreamer &&
    (state.appState.twitchSessionSyncState.nextRetryAt ?? 0) > Date.now()
  )
    return;
  if (!callback) {
    applyApiBackoff(state);
    markTwitchSessionRetrying(state, state.apiBackoffUntil, state.apiConsecutiveFailures);
    return;
  }
  await callback({
    stopReason: 'sign-in-required',
    stopMessage: SIGN_IN_REQUIRED_MESSAGE,
  });
  if (
    state.appState.isRunning &&
    !state.appState.isPaused &&
    state.appState.twitchSessionSyncState.status !== 'retrying'
  ) {
    applyApiBackoff(state);
    markTwitchSessionRetrying(state, state.apiBackoffUntil, state.apiConsecutiveFailures);
  }
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
      await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
    }
    return null;
  }
  if (!session.userId) {
    deps.logWarn('Twitch session has no userId — attempting auto-detect', deps.sessionDebugSummary(session));
    const detectionSession = session;
    const detectionRevision = currentTwitchSessionRevision(state);
    const detectionIsCurrent = () =>
      currentTwitchSessionRevision(state) === detectionRevision &&
      (!state.twitchSessionCache || state.twitchSessionCache.oauthToken === detectionSession.oauthToken);
    let transientFailure = false;
    let explicitAuthFailure = false;
    try {
      const sessionForDetect = await callbacks.onEnsureSessionIntegrity(state, session);
      if (!detectionIsCurrent()) return null;
      const detectedId = await new deps.TwitchApiClient(sessionForDetect).fetchCurrentUserId();
      if (!detectionIsCurrent()) return null;
      if (detectedId) {
        deps.logInfo('Auto-detected Twitch userId', { userId: detectedId });
        session = { ...session, userId: detectedId, clientIntegrity: sessionForDetect.clientIntegrity };
        await bindCampaignEvidenceAccount(state, detectedId);
        if (!detectionIsCurrent()) return null;
        state.twitchSessionCache = session;
        await callbacks.onPersistTwitchSession(session);
        clearSignInRequiredStop(state);
      } else deps.logWarn('Could not auto-detect userId — user may not be logged in');
    } catch (error) {
      if (!detectionIsCurrent()) return null;
      if (callbacks.onIsLikelyAuthError(error)) {
        explicitAuthFailure = true;
        deps.logWarn('Failed to auto-detect userId: auth error', String(error));
        await callbacks.onClearTwitchSessionCache(state);
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
        await stopForSignInRequiredIfRunning(
          state,
          requestOptions.preserveSessionOnAuthFailure ? undefined : callbacks.onStopFarmingSession,
        );
      } else {
        applyApiBackoff(state);
        if (state.appState.isRunning) {
          markTwitchSessionRetrying(state, state.apiBackoffUntil, state.apiConsecutiveFailures);
        }
      }
      return null;
    }
  }

  requestOptions.onSessionResolved?.(session);

  deps.logDebug('Fetching drops snapshot via API', {
    recoveryMode,
    ...deps.sessionDebugSummary(session),
  });
  try {
    return await fetchDropsSnapshotFromApi(state, session, options);
  } catch (error) {
    if (callbacks.onIsLikelyAuthError(error)) {
      await callbacks.onClearTwitchSessionCache(state);
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
      await stopForSignInRequiredIfRunning(
        state,
        requestOptions.preserveSessionOnAuthFailure ? undefined : callbacks.onStopFarmingSession,
      );
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
