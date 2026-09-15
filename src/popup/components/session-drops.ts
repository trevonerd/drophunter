import { mergeDropProgressMonotonic } from '../../shared/drops';
import { dropMatchesGame, gameKey } from '../../shared/game-selection';
import { isRewardAutomatable } from '../../shared/reward-semantics';
import type { AppState, TwitchDrop } from '../../types';

function remainingMinutesOrInfinity(drop: TwitchDrop): number {
  return typeof drop.remainingMinutes === 'number' && Number.isFinite(drop.remainingMinutes)
    ? Math.max(0, drop.remainingMinutes)
    : Number.POSITIVE_INFINITY;
}

function compareRemainingSessionDrops(left: TwitchDrop, right: TwitchDrop): number {
  const byProgress = right.progress - left.progress;
  if (byProgress !== 0) return byProgress;

  const byEta = remainingMinutesOrInfinity(left) - remainingMinutesOrInfinity(right);
  if (byEta !== 0) return byEta;

  return left.name.localeCompare(right.name);
}

export function remainingSessionDrops(state: AppState): TwitchDrop[] {
  const selected = state.selectedGame;
  if (!selected) return [];

  const sources = [
    ...(state.campaignDropsByKey?.[gameKey(selected)] ?? []),
    ...state.allDrops,
    ...state.pendingDrops,
    ...state.completedDrops,
    ...(state.currentDrop ? [state.currentDrop] : []),
  ];
  const rewards = new Map<string, TwitchDrop>();
  for (const drop of sources) {
    if (!dropMatchesGame(drop, selected)) continue;
    const key = `${drop.campaignId ?? drop.gameId}:${drop.id}`;
    const previous = rewards.get(key);
    rewards.set(key, previous ? mergeDropProgressMonotonic(drop, previous) : drop);
  }
  return [...rewards.values()].filter(isRewardAutomatable).sort(compareRemainingSessionDrops);
}
