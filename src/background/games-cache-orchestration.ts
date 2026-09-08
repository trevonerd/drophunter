// Extracted from service-worker.ts (batch 7 of the architecture deepening).
// Owns the Twitch games-cache refresh orchestration: hidden-fetch Drops
// snapshot pull, campaign/game reconciliation, authoritative-empty handling,
// and the ENSURE_GAMES_CACHE runtime message wrapper. Free functions taking
// explicit `state` + dep callbacks — they do NOT close over any adapter
// factory and have no shared mutable state.

import { dropMatchesGame, isSameGameIdentity } from '../shared/game-selection';
import { isRewardAutomatable } from '../shared/reward-semantics';
import type { TwitchGame } from '../types';
import { preserveAcquiredCampaigns, rememberAcquiredCampaigns } from './campaign-completion-evidence.ts';
import {
  type DropsSnapshotProvenance,
  dropStateKey,
  hasCompleteIdentifiedRewardSet,
  reconcileUnverifiableRewardMarkers,
} from './drops-projection';
import { snapshotProvenance } from './drops-snapshot-provenance.ts';
import type { GamesCacheRefreshDeps, RefreshGamesCacheOptions } from './games-cache-contracts.ts';
import { applyAuthoritativeEmptyCampaignRefresh } from './games-cache-empty.ts';
import { applyProgressiveCampaignSnapshot } from './games-cache-progressive.ts';
import {
  type GamesCacheRefreshResult,
  getGamesCacheRefreshInFlight,
  mergeUniqueDrops,
  removeTerminalSummary,
  setGamesCacheRefreshInFlight,
} from './games-cache-refresh-state.ts';
import {
  cleanUnavailableQueueCampaigns,
  type QueueAvailabilityCleanupResult,
} from './queue-availability-cleanup.ts';
import {
  combineQueueCleanupResults,
  notifyQueueCleanup,
  persistQueueCleanup,
  recordQueueCleanupActivity,
} from './queue-availability-cleanup-activity.ts';
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
            await applyProgressiveCampaignSnapshot(
              state,
              snapshot,
              deps,
              () => options.isCurrent?.() !== false,
            );
            if (options.isCurrent?.() === false) return;
            await options.onProgressiveSnapshotApplied?.();
            deps.onProgressiveSnapshotApplied?.();
          },
        })
      : await deps.fetchDropsSnapshot();
    if (options.isCurrent?.() === false) return { kind: 'unavailable', games: state.appState.availableGames };
    rememberAcquiredCampaigns(state.appState, [
      ...state.appState.availableGames,
      ...state.appState.queue,
      ...(state.appState.selectedGame ? [state.appState.selectedGame] : []),
      ...(apiSnapshot?.games ?? []),
    ]);
    const elapsedQueueCleanup = cleanUnavailableQueueCampaigns(state);
    if (!apiSnapshot && options.requireFreshSnapshot) {
      if (elapsedQueueCleanup.selectedRemoved && state.appState.isRunning && state.appState.selectedGame) {
        await deps.onAuthoritativeCampaignUnavailable?.(state.appState.selectedGame);
      }
      await persistQueueCleanup(state, elapsedQueueCleanup, deps);
      const failure = deps.getLastTwitchApiFailure?.() ?? undefined;
      return { kind: 'unavailable', games: state.appState.availableGames, ...(failure ? { failure } : {}) };
    }
    const previousSelectedGame = state.appState.selectedGame;
    const previousSelectedDrops = previousSelectedGame
      ? mergeUniqueDrops(
          state.cachedDropsSnapshot.filter((drop) => dropMatchesGame(drop, previousSelectedGame)),
          state.appState.allDrops.filter((drop) => dropMatchesGame(drop, previousSelectedGame)),
        )
      : [];
    let queueCleanup = elapsedQueueCleanup;
    if (apiSnapshot) {
      const authoritativeQueueCleanup =
        apiSnapshot.campaignsVerified === true
          ? cleanUnavailableQueueCampaigns(state, {
              authoritativeGames: apiSnapshot.games,
              authoritativeCampaignIds: apiSnapshot.authoritativeCampaignIds,
            })
          : ({ removed: [], selectedRemoved: false } satisfies QueueAvailabilityCleanupResult);
      queueCleanup = combineQueueCleanupResults(elapsedQueueCleanup, authoritativeQueueCleanup);
      if (apiSnapshot.games.length === 0 && apiSnapshot.drops.length === 0) {
        const shouldAccept =
          options.acceptAuthoritativeEmpty !== false &&
          apiSnapshot.campaignsVerified === true &&
          apiSnapshot.authoritativeCampaignIds?.length === 0;
        if (shouldAccept) {
          const unavailableCampaign = state.appState.isRunning ? state.appState.selectedGame : null;
          if (unavailableCampaign && deps.onAuthoritativeCampaignUnavailable) {
            await deps.onAuthoritativeCampaignUnavailable(unavailableCampaign);
          }
          if (options.isCurrent?.() === false)
            return { kind: 'unavailable', games: state.appState.availableGames };
          await applyAuthoritativeEmptyCampaignRefresh(state, deps, unavailableCampaign !== null);
        }
        await persistQueueCleanup(state, queueCleanup, deps);
        return {
          kind: 'refreshed',
          games: [],
          authoritativeEmpty: shouldAccept,
          ...(apiSnapshot.inventoryVerified === undefined
            ? {}
            : { inventoryVerified: apiSnapshot.inventoryVerified }),
        };
      }
      provenance = snapshotProvenance(apiSnapshot);
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
      apiSnapshot?.campaignsVerified === true &&
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
        game.rewardSummary?.completion === 'farming-complete'
          ? removeTerminalSummary(game)
          : game,
      );
    }
    rememberAcquiredCampaigns(state.appState, annotatedGames);
    annotatedGames = preserveAcquiredCampaigns(state.appState, annotatedGames);
    state.appState.availableGames = annotatedGames;
    const unavailableSelectedCampaign =
      authoritativeUnavailableCampaign ??
      (queueCleanup.selectedRemoved && state.appState.isRunning ? state.appState.selectedGame : null);
    if (unavailableSelectedCampaign && deps.onAuthoritativeCampaignUnavailable) {
      await deps.onAuthoritativeCampaignUnavailable(unavailableSelectedCampaign);
    } else {
      deps.normalizeGameSelection(state, annotatedGames, Boolean(apiSnapshot));
      deps.normalizeQueueSelection(state, annotatedGames, apiSnapshot?.campaignsVerified === true);
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
    if (options.isCurrent?.() === false) return { kind: 'unavailable', games: state.appState.availableGames };
    recordQueueCleanupActivity(state, queueCleanup);
    await deps.saveState(state);
    await notifyQueueCleanup(queueCleanup, deps);
    return apiSnapshot
      ? {
          kind: 'refreshed',
          games: annotatedGames,
          ...(apiSnapshot.inventoryVerified === undefined
            ? {}
            : { inventoryVerified: apiSnapshot.inventoryVerified }),
        }
      : { kind: 'cached', games: annotatedGames };
  })().finally(() => {
    setGamesCacheRefreshInFlight(state, null);
  });
  setGamesCacheRefreshInFlight(state, refreshInFlight);

  return refreshInFlight;
}

export { type EnsureGamesCacheDeps, handleEnsureGamesCache } from './games-cache-ensure.ts';
