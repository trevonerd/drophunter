import type {
  CampaignRemainderReason,
  CampaignRewardSummary,
  RewardAcquisitionMethod,
  RewardKind,
  TwitchDrop,
} from '../types/index.ts';
import { isDropCompleted } from './drops.ts';

function assertNever(value: never): never {
  throw new TypeError(`Unhandled reward semantic: ${String(value)}`);
}

export function isTwitchNativeReward(drop: TwitchDrop): boolean {
  const rewardKind: RewardKind = drop.rewardKind;

  switch (rewardKind) {
    case 'twitch-badge':
    case 'twitch-emote':
      return true;
    case 'in-game':
    case 'unknown':
      return false;
    default:
      return assertNever(rewardKind);
  }
}

export function isRewardAcquired(drop: TwitchDrop): boolean {
  return isTwitchNativeReward(drop) ? drop.verificationState === 'verified' : isDropCompleted(drop);
}

export function isTwitchNativeAcquisitionUnverifiable(drop: TwitchDrop): boolean {
  return (
    isTwitchNativeReward(drop) &&
    drop.verificationState !== 'verified' &&
    (drop.verificationState === 'unverifiable' || drop.claimed)
  );
}

export function isRewardAutomatable(drop: TwitchDrop): boolean {
  if (isRewardAcquired(drop)) return false;
  if (isTwitchNativeAcquisitionUnverifiable(drop)) return false;

  const acquisitionMethod: RewardAcquisitionMethod = drop.acquisitionMethod;

  switch (acquisitionMethod) {
    case 'subscription':
    case 'other-event':
      return false;
    case 'watch-time':
    case 'unknown':
      return true;
    default:
      return assertNever(acquisitionMethod);
  }
}

export function summarizeCampaignRewards(knownCompleteRewards: readonly TwitchDrop[]): CampaignRewardSummary {
  if (knownCompleteRewards.length === 0) {
    return { completion: 'farmable', remainderReasons: [] };
  }

  if (knownCompleteRewards.every(isRewardAcquired)) {
    return { completion: 'all-acquired', remainderReasons: [] };
  }

  if (knownCompleteRewards.some(isRewardAutomatable)) {
    return { completion: 'farmable', remainderReasons: [] };
  }

  const remainingDrops = knownCompleteRewards.filter((drop) => !isRewardAcquired(drop));
  const remainderReasons: CampaignRemainderReason[] = [];

  if (remainingDrops.some((drop) => drop.acquisitionMethod === 'subscription')) {
    remainderReasons.push('subscription-required');
  }
  if (remainingDrops.some(isTwitchNativeAcquisitionUnverifiable)) {
    remainderReasons.push('unverifiable-twitch');
  }

  return { completion: 'farming-complete', remainderReasons };
}
