import type { DropsSnapshot, TwitchGame, TwitchStreamer } from '../types';
import {
  type FetchDropsSnapshotFromApiCallbacks,
  stopForSignInRequiredIfRunning,
} from './api-drops-wrapper.ts';
import {
  applyApiBackoff,
  fetchDirectoryStreamersFromApi,
  fetchInventorySnapshotFromApi,
} from './api-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { SessionRecoveryMode, TwitchApiRequestOptions } from './session-orchestrator.ts';
import type { TwitchSession } from './twitch-api/types.ts';
import { markTwitchSessionRetrying } from './twitch-session-sync.ts';

export interface FetchInventorySnapshotFromApiCallbacks {
  onEnsureTwitchSession: () => Promise<TwitchSession | null>;
  onRecoverTwitchSessionAfterAuthError?: (mode: SessionRecoveryMode) => Promise<TwitchSession | null>;
  onIsLikelyAuthError: (error: unknown) => boolean;
  onClearTwitchSessionCache: (state: ServiceWorkerState) => void;
  onStopFarmingSession?: FetchDropsSnapshotFromApiCallbacks['onStopFarmingSession'];
}

export async function fetchInventorySnapshotFromApiWrapper(
  state: ServiceWorkerState,
  baseDrops: DropsSnapshot['drops'],
  options: TwitchApiRequestOptions,
  callbacks: FetchInventorySnapshotFromApiCallbacks,
  deps: { logWarn: (msg: string, ctx?: unknown) => void },
  authRecoveryAttempted = false,
  recoveredSession: TwitchSession | null = null,
): Promise<DropsSnapshot | null> {
  const recoveryMode = options.sessionRecoveryMode ?? 'passive';
  const session = recoveredSession ?? (await callbacks.onEnsureTwitchSession());
  if (!session) {
    deps.logWarn('Inventory snapshot API skipped: Twitch session missing');
    if (recoveryMode === 'background-tab' && !authRecoveryAttempted) {
      const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError?.(recoveryMode);
      if (recovered) {
        return fetchInventorySnapshotFromApiWrapper(
          state,
          baseDrops,
          options,
          callbacks,
          deps,
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
  try {
    return await fetchInventorySnapshotFromApi(state, session, baseDrops);
  } catch (error) {
    if (callbacks.onIsLikelyAuthError(error)) {
      callbacks.onClearTwitchSessionCache(state);
      if (!authRecoveryAttempted && callbacks.onRecoverTwitchSessionAfterAuthError) {
        const recovered = await callbacks.onRecoverTwitchSessionAfterAuthError(recoveryMode);
        if (recovered) {
          return fetchInventorySnapshotFromApiWrapper(
            state,
            baseDrops,
            options,
            callbacks,
            deps,
            true,
            recovered,
          );
        }
      }
      deps.logWarn('Twitch inventory auth failed after explicit session recovery:', String(error));
      await stopForSignInRequiredIfRunning(state, callbacks.onStopFarmingSession);
      return null;
    }
    deps.logWarn('Twitch inventory snapshot fetch failed:', String(error));
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
  deps: { logWarn: (msg: string, ctx?: unknown) => void },
): Promise<TwitchStreamer[] & { languageFilterApplied: boolean }> {
  const session = await callbacks.onEnsureTwitchSession(forceSessionRefresh);
  if (!session) deps.logWarn('Directory streamers fetch: session missing, using public client');
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
