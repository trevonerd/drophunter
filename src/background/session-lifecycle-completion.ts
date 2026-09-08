import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { dropMatchesGame, findMatchingGame } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAutomatable } from '../shared/reward-semantics.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export function hasScheduledPendingRewards(state: ServiceWorkerState): boolean {
  if (state.appState.selectedGame && isExpiredGame(state.appState.selectedGame)) return false;
  const now = Date.now();
  return state.appState.pendingDrops.some(
    (drop) => isRewardAutomatable(drop) && Boolean(drop.startsAt && Date.parse(drop.startsAt) > now),
  );
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

export function selectedFarmingCompleteGame(state: ServiceWorkerState): TwitchGame | null {
  if (hasScheduledPendingRewards(state)) return null;
  const selected = state.appState.selectedGame;
  if (
    !selected ||
    state.appState.pendingDrops.some((drop) => dropMatchesGame(drop, selected) && isRewardFarmableNow(drop))
  ) {
    return null;
  }
  const current = findMatchingGame(selected, state.appState.availableGames) ?? selected;
  return current.rewardSummary?.completion === 'farming-complete' ? current : null;
}

export function isKnownCompletedSelection(state: ServiceWorkerState, complete: TwitchGame | null): boolean {
  if (hasScheduledPendingRewards(state)) return false;
  return (
    complete !== null ||
    ((state.appState.allDrops.length > 0 || selectedGameMarkedCompleted(state)) &&
      !state.appState.pendingDrops.some((drop) => isRewardFarmableNow(drop)) &&
      state.appState.currentDrop === null)
  );
}
