import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { dropMatchesGame, findMatchingGame } from '../shared/game-selection.ts';
import { isRewardFarmableNow, isRewardScheduledForFuture } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { hasCompleteIdentifiedRewardSet } from './campaign-reward-identity.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export function hasCompletedCampaignWatchTime(state: ServiceWorkerState, game: TwitchGame): boolean {
  const drops = (
    state.cachedDropsSnapshot.length ? state.cachedDropsSnapshot : state.appState.allDrops
  ).filter((drop) => dropMatchesGame(drop, game));
  return (
    hasCompleteIdentifiedRewardSet(game, drops, true) &&
    drops.some((drop) => !isRewardAcquired(drop)) &&
    drops.every(
      (drop) =>
        isRewardAcquired(drop) ||
        ((drop.acquisitionMethod === 'watch-time' || drop.acquisitionMethod === 'unknown') &&
          (drop.claimable || drop.progress >= 100)),
    )
  );
}

function hasScheduledPendingRewards(state: ServiceWorkerState): boolean {
  if (state.appState.selectedGame && isExpiredGame(state.appState.selectedGame)) return false;
  return state.appState.pendingDrops.some((drop) => isRewardScheduledForFuture(drop));
}

export function isWaitingForScheduledRewards(state: ServiceWorkerState): boolean {
  return (
    hasScheduledPendingRewards(state) &&
    !state.appState.pendingDrops.some((drop) => isRewardFarmableNow(drop))
  );
}

export function selectedGameMarkedCompleted(state: ServiceWorkerState): boolean {
  const selected = state.appState.selectedGame;
  if (!selected) return false;
  const current = findMatchingGame(selected, state.appState.availableGames);
  return isCampaignAcquired(selected) || (current !== null && isCampaignAcquired(current));
}
