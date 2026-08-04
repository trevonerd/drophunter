import type { TwitchDrop } from '../types/index.ts';
import { isRewardAutomatable } from './reward-semantics.ts';

export const REWARD_EXPIRY_SAFETY_MARGIN_MS = 5 * 60_000;

function remainingWatchMinutes(drop: TwitchDrop): number | null {
  if (typeof drop.remainingMinutes === 'number' && Number.isFinite(drop.remainingMinutes)) {
    return Math.max(0, drop.remainingMinutes);
  }
  if (
    typeof drop.requiredMinutes === 'number' &&
    Number.isFinite(drop.requiredMinutes) &&
    Number.isFinite(drop.currentMinutes)
  ) {
    return Math.max(0, drop.requiredMinutes - drop.currentMinutes);
  }
  return null;
}

export function isRewardCompletableBeforeExpiry(
  drop: TwitchDrop,
  now = Date.now(),
  safetyMarginMs = REWARD_EXPIRY_SAFETY_MARGIN_MS,
): boolean {
  if (drop.claimable === true) return true;
  if (!drop.endsAt) return true;

  const endsAt = Date.parse(drop.endsAt);
  const remainingMinutes = remainingWatchMinutes(drop);
  if (!Number.isFinite(endsAt) || remainingMinutes === null) return true;

  return now + remainingMinutes * 60_000 + safetyMarginMs <= endsAt;
}

export function isRewardFarmableNow(drop: TwitchDrop, now = Date.now()): boolean {
  return isRewardAutomatable(drop) && isRewardCompletableBeforeExpiry(drop, now);
}
