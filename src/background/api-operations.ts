import { clearTerminalStopStatus } from '../shared/runtime-status.ts';
import { toSlug } from '../shared/utils.ts';
import type { DropsSnapshot, TwitchGame, TwitchStreamer } from '../types';
import { INTEGRITY_FALLBACK_TTL_MS, PROGRESS_POLL_MS } from './constants.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { ensureSessionIntegrity as ensureSessionIntegrityExt } from './session-management.ts';
import { type FetchDropsSnapshotOptions, TwitchApiClient } from './twitch-api/client.ts';
import { isLikelyAuthError, type TwitchSession } from './twitch-api/types.ts';
import { markTwitchSessionReady } from './twitch-session-sync.ts';

export type { FetchDropsSnapshotFromApiCallbacks } from './api-drops-wrapper.ts';
export { fetchDropsSnapshotFromApiWrapper } from './api-drops-wrapper.ts';
export type {
  FetchDirectoryStreamersFromApiCallbacks,
  FetchInventorySnapshotFromApiCallbacks,
} from './api-secondary-wrappers.ts';
export {
  fetchDirectoryStreamersFromApiWrapper,
  fetchInventorySnapshotFromApiWrapper,
} from './api-secondary-wrappers.ts';

export function applyApiBackoff(state: ServiceWorkerState) {
  state.apiConsecutiveFailures += 1;
  state.apiBackoffUntil =
    Date.now() + Math.min(2 ** Math.max(0, state.apiConsecutiveFailures - 1) * PROGRESS_POLL_MS, 10 * 60_000);
}

export function clearSignInRequiredStop(state: ServiceWorkerState) {
  markTwitchSessionReady(state);
  if (state.appState.lastStopReason === 'sign-in-required') {
    state.appState = clearTerminalStopStatus(state.appState);
  }
}

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
      const refreshed = await ensureSessionIntegrityExt(state, session, true);
      if (refreshed.clientIntegrity && refreshed.clientIntegrity !== sessionWithIntegrity.clientIntegrity) {
        try {
          const snapshot = await fetchSnapshot(new TwitchApiClient(refreshed));
          state.apiConsecutiveFailures = 0;
          state.apiBackoffUntil = 0;
          clearSignInRequiredStop(state);
          return snapshot;
        } catch (retryError) {
          logDebug('Integrity-refreshed retry still failed, falling back to no-integrity mode', {
            error: String(retryError),
          });
        }
      }
      try {
        const withoutIntegrity: TwitchSession = { ...session, clientIntegrity: undefined };
        const snapshot = await fetchSnapshot(new TwitchApiClient(withoutIntegrity));
        state.integrityFallbackActive = true;
        state.integrityFallbackActiveUntil = Date.now() + INTEGRITY_FALLBACK_TTL_MS;
        state.apiConsecutiveFailures = 0;
        state.apiBackoffUntil = 0;
        clearSignInRequiredStop(state);
        return snapshot;
      } catch (fallbackError) {
        logDebug('No-integrity fallback fetch also failed', { error: String(fallbackError) });
      }
    }
    if (isLikelyAuthError(error)) throw error;
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
  if (baseDrops.length === 0) return null;
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
    return await client.fetchDirectoryStreamers(game.name, game.categorySlug ?? toSlug(game.name), language);
  } catch {
    applyApiBackoff(state);
    return Object.assign([], { languageFilterApplied: false });
  }
}
