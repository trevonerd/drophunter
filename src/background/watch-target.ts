import type { TwitchDrop } from '../types/index.ts';
import type { FarmingTarget } from './watch-transport.ts';

export function dropsForFarmingTarget(drops: readonly TwitchDrop[], target: FarmingTarget): TwitchDrop[] {
  const selectionId = target.selectionId ?? target.gameId;
  return drops.filter((drop) => {
    if (drop.campaignId && target.campaignId) return drop.campaignId === target.campaignId;
    return drop.gameId === selectionId;
  });
}
