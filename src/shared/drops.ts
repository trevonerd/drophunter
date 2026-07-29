import type { TwitchDrop } from '../types/index.ts';

function retainKnownClassification<T extends string>(nextClassification: T, previousClassification: T): T {
  return nextClassification === 'unknown' ? previousClassification : nextClassification;
}

export function mergeDropProgressMonotonic(nextDrop: TwitchDrop, previousDrop: TwitchDrop): TwitchDrop {
  const mergedProgress = Math.max(nextDrop.progress, previousDrop.progress);
  const mergedClaimed = nextDrop.claimed || previousDrop.claimed;
  const mergedClaimable = mergedClaimed ? false : Boolean(nextDrop.claimable);
  const mergedRequiredMinutes = nextDrop.requiredMinutes ?? previousDrop.requiredMinutes ?? null;
  const mergedRemainingMinutes =
    mergedClaimed || mergedClaimable
      ? 0
      : nextDrop.remainingMinutes !== undefined && nextDrop.remainingMinutes !== null
        ? previousDrop.remainingMinutes !== undefined && previousDrop.remainingMinutes !== null
          ? Math.min(previousDrop.remainingMinutes, nextDrop.remainingMinutes)
          : nextDrop.remainingMinutes
        : (previousDrop.remainingMinutes ?? null);

  return {
    ...nextDrop,
    progress: mergedClaimed || mergedClaimable ? 100 : mergedProgress,
    claimed: mergedClaimed,
    claimable: mergedClaimable,
    imageUrl: nextDrop.imageUrl || previousDrop.imageUrl,
    campaignId: nextDrop.campaignId || previousDrop.campaignId,
    requiredMinutes: mergedRequiredMinutes,
    remainingMinutes: mergedRemainingMinutes,
    progressSource: nextDrop.progressSource ?? previousDrop.progressSource,
    acquisitionMethod: retainKnownClassification(nextDrop.acquisitionMethod, previousDrop.acquisitionMethod),
    rewardKind: retainKnownClassification(nextDrop.rewardKind, previousDrop.rewardKind),
    verificationState:
      previousDrop.verificationState === 'verified' ? 'verified' : nextDrop.verificationState,
    status: mergedClaimed
      ? 'completed'
      : mergedClaimable
        ? 'active'
        : mergedProgress >= 100
          ? 'completed'
          : mergedProgress > 0
            ? 'active'
            : 'pending',
  };
}

export function isDropCompleted(drop: TwitchDrop): boolean {
  return drop.claimed || (drop.progress >= 100 && !drop.claimable);
}

export function haveAllDropsExpiredOrVanished(
  allDrops: TwitchDrop[],
  previousAllDropsCount: number,
): boolean {
  if (allDrops.length === 0) {
    return previousAllDropsCount > 0;
  }

  const nonCompleted = allDrops.filter((drop) => !isDropCompleted(drop));
  if (nonCompleted.length === 0) return false;

  return nonCompleted.every((drop) => {
    if (!drop.endsAt) return false;
    const endsAtMs = new Date(drop.endsAt).getTime();
    return Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
  });
}
