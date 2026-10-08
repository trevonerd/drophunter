import {
  dedupeGamesByIdentity,
  dropMatchesGame,
  gameKey,
  replaceAvailableGames,
} from '../shared/game-selection.ts';
import type { DropsSnapshot } from '../types/index.ts';
import {
  preserveAcquiredCampaigns,
  rememberAcquiredCampaigns,
  rememberKnownAcquiredCampaigns,
} from './campaign-completion-evidence.ts';
import {
  annotateGameCompletion,
  reconcileUnverifiableRewardMarkers,
  splitDropsForSelectedGame,
} from './drops-projection.ts';
import { snapshotProvenance } from './drops-projection-semantics.ts';
import type { GamesCacheRefreshDeps } from './games-cache-orchestration.ts';
import { mergeUniqueDrops } from './games-cache-refresh-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export async function applyProgressiveCampaignSnapshot(
  state: ServiceWorkerState,
  snapshot: DropsSnapshot,
  deps: GamesCacheRefreshDeps,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  rememberKnownAcquiredCampaigns(state.appState, snapshot.games);
  const mergedGames = replaceAvailableGames(
    dedupeGamesByIdentity([...state.appState.availableGames, ...snapshot.games]),
  );
  const mergedSnapshot: DropsSnapshot = {
    games: mergedGames,
    drops: mergeUniqueDrops(state.cachedDropsSnapshot, snapshot.drops),
    campaignChannelsMap: { ...state.cachedCampaignChannelsMap, ...snapshot.campaignChannelsMap },
    updatedAt: snapshot.updatedAt,
  };
  const provenance = snapshotProvenance(snapshot);
  const reconciledDrops = reconcileUnverifiableRewardMarkers(state, mergedSnapshot, provenance);
  state.cachedDropsSnapshot = reconciledDrops;
  state.cachedCampaignChannelsMap = mergedSnapshot.campaignChannelsMap ?? state.cachedCampaignChannelsMap;
  const completionAnnotations = annotateGameCompletion(mergedGames, reconciledDrops, provenance);
  rememberAcquiredCampaigns(state.appState, completionAnnotations);
  const annotatedGames = preserveAcquiredCampaigns(state.appState, completionAnnotations);
  state.appState.availableGames = annotatedGames;
  state.appState.campaignDropsByKey = Object.fromEntries(
    annotatedGames.map((game) => [
      gameKey(game),
      reconciledDrops.filter((drop) => dropMatchesGame(drop, game)),
    ]),
  );
  if (state.appState.selectedGame) splitDropsForSelectedGame(state, reconciledDrops);
  state.appState.lastSuccessfulRefreshAt = Date.now();
  if (!isCurrent()) return;
  await deps.saveState(state);
}
