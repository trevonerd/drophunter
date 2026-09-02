// Extracted from service-worker.ts (batch 7 of the architecture deepening).
// Owns the Twitch games-cache refresh orchestration: hidden-fetch Drops
// snapshot pull, campaign/game reconciliation, authoritative-empty handling,
// and the ENSURE_GAMES_CACHE runtime message wrapper. Free functions taking
// explicit `state` + dep callbacks — they do NOT close over any adapter
// factory and have no shared mutable state.

import { dropMatchesGame, gameKey, isSameGameIdentity } from '../shared/game-selection';
import { isRewardAutomatable } from '../shared/reward-semantics';
import type { DropsSnapshot, TwitchGame } from '../types';
import {
  type DropsSnapshotProvenance,
  dropStateKey,
  hasCompleteIdentifiedRewardSet,
  reconcileUnverifiableRewardMarkers,
} from './drops-projection';
import type { GamesCacheRefreshDeps, RefreshGamesCacheOptions } from './games-cache-contracts.ts';
import {
  type GamesCacheRefreshResult,
  getGamesCacheRefreshInFlight,
  mergeUniqueDrops,
  removeTerminalSummary,
  setGamesCacheRefreshInFlight,
} from './games-cache-refresh-state.ts';
import type { ServiceWorkerState } from './runtime-state';

export type { GamesCacheRefreshDeps, RefreshGamesCacheOptions } from './games-cache-contracts.ts';

export type { GamesCacheRefreshResult } from './games-cache-refresh-state.ts';

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
      ? await deps.fetchDropsSnapshotProgressively({
          priorityGameIds,
          onProgress: async (snapshot) => {
            await applyProgressiveCampaignSnapshot(state, snapshot, deps);
            await options.onProgressiveSnapshotApplied?.();
            deps.onProgressiveSnapshotApplied?.();
          },
        })
      : await deps.fetchDropsSnapshot();
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
          const unavailableCampaign = state.appState.isRunning ? state.appState.selectedGame : null;
          if (unavailableCampaign && deps.onAuthoritativeCampaignUnavailable) {
            await deps.onAuthoritativeCampaignUnavailable(unavailableCampaign);
          }
          await applyAuthoritativeEmptyCampaignRefresh(state, deps, unavailableCampaign !== null);
        }
        return {
          kind: 'refreshed',
          games: [],
          authoritativeEmpty: shouldAccept,
          ...(apiSnapshot.inventoryVerified === undefined
            ? {}
            : { inventoryVerified: apiSnapshot.inventoryVerified }),
        };
      }
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
    const authoritativeUnavailableCampaign =
      provenance === 'campaign-authoritative' &&
      state.appState.isRunning &&
      previousSelectedGame &&
      (!freshSelectedGame || !hasFreshFarmableEvidence)
        ? previousSelectedGame
        : null;
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
    if (authoritativeUnavailableCampaign && deps.onAuthoritativeCampaignUnavailable) {
      await deps.onAuthoritativeCampaignUnavailable(authoritativeUnavailableCampaign);
    } else {
      deps.normalizeGameSelection(state, annotatedGames, Boolean(apiSnapshot));
      deps.normalizeQueueSelection(state, annotatedGames, Boolean(apiSnapshot));
    }
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
    return apiSnapshot
      ? {
          kind: 'refreshed',
          games: mergedGames,
          ...(apiSnapshot.inventoryVerified === undefined
            ? {}
            : { inventoryVerified: apiSnapshot.inventoryVerified }),
        }
      : { kind: 'cached', games: mergedGames };
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
  preserveTerminalStop = false,
): Promise<void> {
  if (state.appState.isRunning) {
    await deps.stopFarmingSession({
      stopReason: 'no-active-campaigns',
      stopMessage: 'No active Twitch Drops campaigns found.',
    });
  } else if (!preserveTerminalStop) {
    state.appState = deps.clearTerminalStopStatus(deps.clearRecoveryStatus(state.appState));
  }

  deps.resetStateForAuthoritativeEmptyCampaign(state);
  state.appState.lastSuccessfulRefreshAt = Date.now();
  deps.resetStreamTrackingState(state);
  state.lastGamesCacheRefreshAt = Date.now();
  await deps.saveState(state);
}

export { type EnsureGamesCacheDeps, handleEnsureGamesCache } from './games-cache-ensure.ts';
