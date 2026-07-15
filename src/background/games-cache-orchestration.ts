// Extracted from service-worker.ts (batch 7 of the architecture deepening).
// Owns the Twitch games-cache refresh orchestration: hidden-fetch Drops
// snapshot pull, campaign/game reconciliation, authoritative-empty handling,
// and the ENSURE_GAMES_CACHE runtime message wrapper. Free functions taking
// explicit `state` + dep callbacks — they do NOT close over any adapter
// factory and have no shared mutable state.

import type { AppState, DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import { logWarn } from './logging';
import type { ServiceWorkerState } from './runtime-state';

export interface RefreshGamesCacheOptions {
  forceSessionRefresh?: boolean;
  acceptAuthoritativeEmpty?: boolean;
  requireFreshSnapshot?: boolean;
  // Require 2+ consecutive empty responses before wiping queue/games. Used
  // by one-shot call sites (e.g. session sync) that have no internal
  // retry-until-ready loop of their own, unlike the drops-page-refresh flow.
  requireConsecutiveEmptyConfirmation?: boolean;
}

export interface GamesCacheRefreshDeps {
  fetchDropsSnapshot: (forceSessionRefresh: boolean) => Promise<DropsSnapshot | null>;
  replaceAvailableGames: (games: TwitchGame[]) => TwitchGame[];
  annotateGameCompletion: (games: TwitchGame[], drops: TwitchDrop[]) => TwitchGame[];
  normalizeGameSelection: (state: ServiceWorkerState, games: TwitchGame[]) => void;
  normalizeQueueSelection: (state: ServiceWorkerState, games: TwitchGame[], hasSnapshot: boolean) => void;
  splitDropsForSelectedGame: (state: ServiceWorkerState, drops: TwitchDrop[]) => void;
  recordEmptyCampaignObservation: (
    state: ServiceWorkerState,
    requireConfirmation: boolean,
  ) => { confirmed: boolean; streak: number };
  resetStateForAuthoritativeEmptyCampaign: (state: ServiceWorkerState) => void;
  clearSelectedCompletedIdleCampaign: (state: ServiceWorkerState) => void;
  resetStreamTrackingState: (state: ServiceWorkerState) => void;
  clearRecoveryStatus: (appState: AppState) => AppState;
  clearTerminalStopStatus: (appState: AppState) => AppState;
  stopFarmingSession: (args: { stopReason: string; stopMessage: string }) => Promise<void>;
  saveState: (state: ServiceWorkerState) => Promise<void>;
}

export async function refreshGamesCacheFromHiddenFetch(
  state: ServiceWorkerState,
  options: RefreshGamesCacheOptions,
  deps: GamesCacheRefreshDeps,
): Promise<TwitchGame[]> {
  if (state.gamesCacheRefreshInFlight) {
    return state.gamesCacheRefreshInFlight;
  }

  state.gamesCacheRefreshInFlight = (async () => {
    let fetchedGames: TwitchGame[] = [];
    const apiSnapshot = await deps.fetchDropsSnapshot(Boolean(options.forceSessionRefresh));
    if (!apiSnapshot && options.requireFreshSnapshot) {
      return [];
    }
    if (apiSnapshot) {
      if (apiSnapshot.games.length === 0 && apiSnapshot.drops.length === 0) {
        const shouldAccept = options.acceptAuthoritativeEmpty !== false;
        if (shouldAccept) {
          const decision = deps.recordEmptyCampaignObservation(
            state,
            Boolean(options.requireConsecutiveEmptyConfirmation),
          );
          if (decision.confirmed) {
            await applyAuthoritativeEmptyCampaignRefresh(state, deps);
          } else {
            logWarn('Empty campaign snapshot received; awaiting confirmation before wiping state', {
              streak: decision.streak,
            });
          }
        }
        return [];
      }
      state.emptyCampaignRefreshStreak = 0;
      if (apiSnapshot.games.length > 0) {
        fetchedGames = apiSnapshot.games;
      }
      state.appState.lastSuccessfulRefreshAt = Date.now();
      if (apiSnapshot.drops.length > 0) {
        state.cachedDropsSnapshot = apiSnapshot.drops;
      } else {
        state.cachedDropsSnapshot = [];
      }
      if (apiSnapshot.campaignChannelsMap) {
        state.cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
    }

    const mergedGames =
      fetchedGames.length > 0 ? deps.replaceAvailableGames(fetchedGames) : state.appState.availableGames;
    const annotatedGames = deps.annotateGameCompletion(mergedGames, state.cachedDropsSnapshot);
    state.appState.availableGames = annotatedGames;
    deps.normalizeGameSelection(state, annotatedGames);
    deps.normalizeQueueSelection(state, annotatedGames, Boolean(apiSnapshot));
    // If a campaign refresh succeeded, the selected campaign split should reflect it,
    // including the valid "no rewards left" case.
    if (state.appState.selectedGame && apiSnapshot) {
      deps.splitDropsForSelectedGame(state, state.cachedDropsSnapshot);
    }
    deps.clearSelectedCompletedIdleCampaign(state);
    deps.resetStreamTrackingState(state);
    state.lastGamesCacheRefreshAt = Date.now();
    await deps.saveState(state);
    return mergedGames;
  })().finally(() => {
    state.gamesCacheRefreshInFlight = null;
  });

  return state.gamesCacheRefreshInFlight;
}

async function applyAuthoritativeEmptyCampaignRefresh(
  state: ServiceWorkerState,
  deps: GamesCacheRefreshDeps,
): Promise<void> {
  if (state.appState.isRunning) {
    await deps.stopFarmingSession({
      stopReason: 'no-active-campaigns',
      stopMessage: 'No active Twitch Drops campaigns found.',
    });
  } else {
    state.appState = deps.clearTerminalStopStatus(deps.clearRecoveryStatus(state.appState));
  }

  deps.resetStateForAuthoritativeEmptyCampaign(state);
  state.appState.lastSuccessfulRefreshAt = Date.now();
  deps.resetStreamTrackingState(state);
  state.lastGamesCacheRefreshAt = Date.now();
  await deps.saveState(state);
}

export interface EnsureGamesCacheDeps {
  awaitInitPromise: () => Promise<void> | null;
  trackActivity: (action: string) => Promise<void>;
  ensureStateHydratedForCache: () => Promise<void>;
  shouldRefreshGamesCache: (state: ServiceWorkerState, force: boolean) => boolean;
  refreshGamesCacheFromHiddenFetch: (options: RefreshGamesCacheOptions) => Promise<TwitchGame[]>;
  annotateGameCompletion: (games: TwitchGame[], drops: TwitchDrop[]) => TwitchGame[];
  saveState: (state: ServiceWorkerState) => Promise<void>;
}

export async function handleEnsureGamesCache(
  state: ServiceWorkerState,
  payload: { force?: boolean } | undefined,
  deps: EnsureGamesCacheDeps,
) {
  await deps.awaitInitPromise();
  await deps.trackActivity('ensure-games-cache');
  await deps.ensureStateHydratedForCache();
  const force = Boolean(payload?.force);
  const shouldRefresh = deps.shouldRefreshGamesCache(state, force);
  if (shouldRefresh) {
    await deps.refreshGamesCacheFromHiddenFetch({ requireConsecutiveEmptyConfirmation: true });
  } else if (state.cachedDropsSnapshot.length > 0) {
    // Cache is fresh — no API call needed. But the games persisted in storage may
    // pre-date the annotation logic (e.g. after an extension update or SW restart).
    // Re-annotate in-memory and persist so the popup reads correct allDropsCompleted flags.
    state.appState.availableGames = deps.annotateGameCompletion(
      state.appState.availableGames,
      state.cachedDropsSnapshot,
    );
    await deps.saveState(state);
  }
  return {
    success: true,
    refreshed: shouldRefresh,
    gamesCount: state.appState.availableGames.length,
    games: state.appState.availableGames,
  };
}
