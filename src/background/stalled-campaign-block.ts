import { gameKey } from '../shared/game-selection.ts';
import type { StalledCampaignBlock, TwitchDrop, TwitchGame } from '../types/index.ts';

export type StalledCampaignBlocksByKey = Readonly<Record<string, StalledCampaignBlock>>;

function rewardProgressKey(drop: TwitchDrop): string {
  return `${drop.id}::${drop.campaignId ?? ''}`;
}

function normalizedStreamerNames(streamerNames: readonly string[]): readonly string[] {
  return Array.from(new Set(streamerNames.map((name) => name.trim().toLowerCase()).filter(Boolean)));
}

export function isCampaignStallBlocked(blocks: StalledCampaignBlocksByKey, campaign: TwitchGame): boolean {
  return blocks[gameKey(campaign)] !== undefined;
}

export function blockCampaignForStall(
  blocks: StalledCampaignBlocksByKey,
  campaign: TwitchGame,
  block: StalledCampaignBlock,
): StalledCampaignBlocksByKey {
  return {
    ...blocks,
    [gameKey(campaign)]: {
      ...block,
      eligibleStreamerNames: normalizedStreamerNames(block.eligibleStreamerNames),
    },
  };
}

export function hasNewEligibleStreamerEvidence(
  block: StalledCampaignBlock | undefined,
  eligibleStreamerNames: readonly string[],
): boolean {
  if (!block) return false;
  const knownNames = new Set(normalizedStreamerNames(block.eligibleStreamerNames));
  return normalizedStreamerNames(eligibleStreamerNames).some((name) => !knownNames.has(name));
}

export function captureRewardProgress(
  drops: readonly TwitchDrop[],
): StalledCampaignBlock['rewardProgressByKey'] {
  return Object.fromEntries(
    drops.map((drop) => [
      rewardProgressKey(drop),
      { progress: drop.progress, currentMinutes: drop.currentMinutes ?? -1 },
    ]),
  );
}

export function hasNewRewardProgressEvidence(
  block: StalledCampaignBlock | undefined,
  drops: readonly TwitchDrop[],
): boolean {
  if (!block) return false;
  return drops.some((drop) => {
    const previous = block.rewardProgressByKey[rewardProgressKey(drop)];
    return (
      previous !== undefined &&
      (drop.progress > previous.progress || (drop.currentMinutes ?? -1) > previous.currentMinutes)
    );
  });
}

export function clearCampaignStallBlock(
  blocks: StalledCampaignBlocksByKey,
  campaign: TwitchGame,
): StalledCampaignBlocksByKey {
  const key = gameKey(campaign);
  if (blocks[key] === undefined) return blocks;
  const { [key]: _clearedBlock, ...remainingBlocks } = blocks;
  return remainingBlocks;
}
