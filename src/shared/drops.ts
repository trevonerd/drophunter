import type { TwitchDrop } from '../types/index.ts';

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
    dropType: nextDrop.dropType ?? previousDrop.dropType,
    status: mergedClaimed
      ? 'completed'
      : mergedClaimable
        ? 'active'
        : mergedProgress > 0
          ? 'active'
          : 'pending',
  };
}

export function isDropCompleted(drop: TwitchDrop): boolean {
  return drop.claimed || (drop.progress >= 100 && !drop.claimable);
}
