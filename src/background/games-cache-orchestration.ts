// Extracted from service-worker.ts (batch 7 of the architecture deepening).
// Owns the Twitch games-cache refresh orchestration: hidden-fetch Drops
// snapshot pull, campaign/game reconciliation, authoritative-empty handling,
// and the ENSURE_GAMES_CACHE runtime message wrapper. Free functions taking
// explicit `state` + dep callbacks — they do NOT close over any adapter
// factory and have no shared mutable state.

import { dropMatchesGame, gameKey, isSameGameIdentity } from '../shared/game-selection';
import { isRewardAutomatable } from '../shared/reward-semantics';
import type { AppState, DropsSnapshot, TwitchDrop, TwitchGame } from '../types';
import {
  type DropsSnapshotProvenance,
  dropStateKey,
  hasCompleteIdentifiedRewardSet,
  reconcileUnverifiableRewardMarkers,
} from './drops-projection';
import {
  type GamesCacheRefreshResult,
  getGamesCacheRefreshInFlight,
  mergeUniqueDrops,
  removeTerminalSummary,
  setGamesCacheRefreshInFlight,
} from './games-cache-refresh-state.ts';
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
  // A partial campaign batch has been applied and persisted. Callers that
  // present refresh progress can release their initial loading state while
  // the remaining batches continue in the background.
  onProgressiveSnapshotApplied?: () => Promise<void> | void;
}

export type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';

export interface GamesCacheRefreshDeps {
  fetchDropsSnapshot: (forceSessionRefresh: boolean) => Promise<DropsSnapshot | null>;
  fetchDropsSnapshotProgressively?: (
    forceSessionRefresh: boolean,
    options: {
      readonly priorityGameIds: readonly string[];
      readonly onProgress: (snapshot: DropsSnapshot) => Promise<void>;
    },
  ) => Promise<DropsSnapshot | null>;
  onProgressiveSnapshotApplied?: () => void;
  replaceAvailableGames: (games: TwitchGame[]) => TwitchGame[];
  annotateGameCompletion: (
    games: TwitchGame[],
    drops: TwitchDrop[],
    provenance: DropsSnapshotProvenance,
  ) => TwitchGame[];
  normalizeGameSelection: (state: ServiceWorkerState, games: TwitchGame[], dropVanished?: boolean) => void;
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
): Promise<GamesCacheRefreshResult> {
  const existingRefresh = getGamesCacheRefreshInFlight(state);
  if (existingRefresh) return existingRefresh;

  const refreshInFlight = (async (): Promise<GamesCacheRefreshResult> => {
    let fetchedGames: TwitchGame[] = [];
    let provenance: DropsSnapshotProvenance = 'cached';
    const priorityGameIds = state.appState.favoriteGames.flatMap((favorite) => [
      favorite.gameId,
      ...(favorite.identityKeys ?? []),
    ]);
    const apiSnapshot = deps.fetchDropsSnapshotProgressively
      ? await deps.fetchDropsSnapshotProgressively(Boolean(options.forceSessionRefresh), {
          priorityGameIds,
          onProgress: async (snapshot) => {
            await applyProgressiveCampaignSnapshot(state, snapshot, deps);
            await options.onProgressiveSnapshotApplied?.();
            deps.onProgressiveSnapshotApplied?.();
          },
        })
      : await deps.fetchDropsSnapshot(Boolean(options.forceSessionRefresh));
    if (!apiSnapshot && options.requireFreshSnapshot) {
      return { kind: 'unavailable', games: state.appState.availableGames };
    }
    const previousSelectedGame = state.appState.selectedGame;
    const previousSelectedDrops = previousSelectedGame
      ? mergeUniqueDrops(
          state.cachedDropsSnapshot.filter((drop) => dropMatchesGame(drop, previousSelectedGame)),
          state.appState.allDrops.filter((drop) => dropMatchesGame(drop, previousSelectedGame)),
        )
      : [];
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
        return { kind: 'refreshed', games: [] };
      }
      state.emptyCampaignRefreshStreak = 0;
      provenance = 'campaign-authoritative';
      if (apiSnapshot.games.length > 0) {
        fetchedGames = apiSnapshot.games;
      }
      state.appState.lastSuccessfulRefreshAt = Date.now();
      state.cachedDropsSnapshot = reconcileUnverifiableRewardMarkers(state, apiSnapshot, provenance);
      if (apiSnapshot.campaignChannelsMap) {
        state.cachedCampaignChannelsMap = apiSnapshot.campaignChannelsMap;
      }
    }

    const mergedGames =
      fetchedGames.length > 0 ? deps.replaceAvailableGames(fetchedGames) : state.appState.availableGames;
    if (!apiSnapshot) {
      state.cachedDropsSnapshot = reconcileUnverifiableRewardMarkers(
        state,
        { games: mergedGames, drops: state.cachedDropsSnapshot, updatedAt: Date.now() },
        provenance,
      );
    }
    let annotatedGames = deps.annotateGameCompletion(mergedGames, state.cachedDropsSnapshot, provenance);
    const freshSelectedGame = previousSelectedGame
      ? annotatedGames.find((game) => isSameGameIdentity(game, previousSelectedGame))
      : undefined;
    const freshSelectedDrops = freshSelectedGame
      ? state.cachedDropsSnapshot.filter((drop) => dropMatchesGame(drop, freshSelectedGame))
      : [];
    const hasFreshFarmableEvidence = freshSelectedDrops.some(isRewardAutomatable);
    const shouldRetainPriorTerminalInspection =
      provenance === 'campaign-authoritative' &&
      previousSelectedGame?.rewardSummary?.completion === 'farming-complete' &&
      freshSelectedGame !== undefined &&
      !hasCompleteIdentifiedRewardSet(freshSelectedGame, state.cachedDropsSnapshot) &&
      !hasFreshFarmableEvidence;
    if (shouldRetainPriorTerminalInspection) {
      const currentDropKeys = new Set(state.cachedDropsSnapshot.map(dropStateKey));
      const retainedDrops = previousSelectedDrops.filter((drop) => !currentDropKeys.has(dropStateKey(drop)));
      if (retainedDrops.length > 0) {
        state.cachedDropsSnapshot = reconcileUnverifiableRewardMarkers(
          state,
          {
            games: mergedGames,
            drops: mergeUniqueDrops(state.cachedDropsSnapshot, retainedDrops),
            updatedAt: Date.now(),
          },
          provenance,
        );
        annotatedGames = deps.annotateGameCompletion(mergedGames, state.cachedDropsSnapshot, provenance);
      }
      annotatedGames = annotatedGames.map((game) =>
        isSameGameIdentity(game, previousSelectedGame)
          ? {
              ...game,
              rewardSummary: previousSelectedGame.rewardSummary,
              ...(previousSelectedGame.allDropsCompleted === undefined
                ? { allDropsCompleted: undefined }
                : { allDropsCompleted: previousSelectedGame.allDropsCompleted }),
            }
          : game,
      );
    } else if (provenance === 'campaign-authoritative' && hasFreshFarmableEvidence) {
      annotatedGames = annotatedGames.map((game) =>
        isSameGameIdentity(game, previousSelectedGame ?? game) &&
        (game.allDropsCompleted === true ||
          game.rewardSummary?.completion === 'farming-complete' ||
          game.rewardSummary?.completion === 'all-acquired')
          ? removeTerminalSummary(game)
          : game,
      );
    }
    state.appState.availableGames = annotatedGames;
    deps.normalizeGameSelection(state, annotatedGames, Boolean(apiSnapshot));
    deps.normalizeQueueSelection(state, annotatedGames, Boolean(apiSnapshot));
    // If a campaign refresh succeeded, the selected campaign split should reflect it,
    // including the valid "no rewards left" case.
    if (state.appState.selectedGame && apiSnapshot) {
      deps.splitDropsForSelectedGame(state, state.cachedDropsSnapshot);
    }
    const selectedGame = state.appState.selectedGame;
    const refreshedSelectedGame = selectedGame
      ? annotatedGames.find((game) => isSameGameIdentity(game, selectedGame))
      : undefined;
    const preserveTerminalInspection =
      refreshedSelectedGame?.rewardSummary?.completion === 'farming-complete';
    if (!preserveTerminalInspection) {
      deps.clearSelectedCompletedIdleCampaign(state);
    }
    deps.resetStreamTrackingState(state);
    state.lastGamesCacheRefreshAt = Date.now();
    await deps.saveState(state);
    return { kind: apiSnapshot ? 'refreshed' : 'cached', games: mergedGames };
  })().finally(() => {
    setGamesCacheRefreshInFlight(state, null);
  });
  setGamesCacheRefreshInFlight(state, refreshInFlight);

  return refreshInFlight;
}

async function applyProgressiveCampaignSnapshot(
  state: ServiceWorkerState,
  snapshot: DropsSnapshot,
  deps: GamesCacheRefreshDeps,
): Promise<void> {
  const mergedGames = deps.replaceAvailableGames([...state.appState.availableGames, ...snapshot.games]);
  const mergedSnapshot: DropsSnapshot = {
    games: mergedGames,
    drops: mergeUniqueDrops(state.cachedDropsSnapshot, snapshot.drops),
    campaignChannelsMap: { ...state.cachedCampaignChannelsMap, ...snapshot.campaignChannelsMap },
    updatedAt: snapshot.updatedAt,
  };
  const reconciledDrops = reconcileUnverifiableRewardMarkers(state, mergedSnapshot, 'campaign-authoritative');
  state.cachedDropsSnapshot = reconciledDrops;
  state.cachedCampaignChannelsMap = mergedSnapshot.campaignChannelsMap ?? state.cachedCampaignChannelsMap;
  const annotatedGames = deps.annotateGameCompletion(mergedGames, reconciledDrops, 'campaign-authoritative');
  state.appState.availableGames = annotatedGames;
  state.appState.campaignDropsByKey = Object.fromEntries(
    annotatedGames.map((game) => [
      gameKey(game),
      reconciledDrops.filter((drop) => dropMatchesGame(drop, game)),
    ]),
  );
  if (state.appState.selectedGame) deps.splitDropsForSelectedGame(state, reconciledDrops);
  state.appState.lastSuccessfulRefreshAt = Date.now();
  await deps.saveState(state);
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
  refreshGamesCacheFromHiddenFetch: (
    options: RefreshGamesCacheOptions,
  ) => Promise<GamesCacheRefreshResult | TwitchGame[]>;
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
  let refreshResult: GamesCacheRefreshResult | null = null;
  if (shouldRefresh) {
    const rawRefreshResult = await deps.refreshGamesCacheFromHiddenFetch({
      requireConsecutiveEmptyConfirmation: true,
    });
    refreshResult = Array.isArray(rawRefreshResult)
      ? { kind: 'cached', games: rawRefreshResult }
      : rawRefreshResult;
  } else if (state.cachedDropsSnapshot.length > 0) {
    // Reapply durable local markers to the fresh cached projection after a worker restart.
    state.cachedDropsSnapshot = reconcileUnverifiableRewardMarkers(
      state,
      {
        games: state.appState.availableGames,
        drops: state.cachedDropsSnapshot,
        updatedAt: Date.now(),
      },
      'cached',
    );
    await deps.saveState(state);
  }
  return {
    success: refreshResult?.kind !== 'unavailable',
    refreshed: shouldRefresh,
    gamesCount: state.appState.availableGames.length,
    games: state.appState.availableGames,
    ...(refreshResult?.kind === 'unavailable'
      ? { error: 'Twitch campaign data is temporarily unavailable. Try again.' }
      : {}),
  };
}
