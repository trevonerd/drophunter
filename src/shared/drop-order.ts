import type { TwitchDrop } from '../types/index';
import { isRewardAutomatable } from './reward-semantics';

function etaOrInfinity(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : Number.POSITIVE_INFINITY;
}

function expiryOrInfinity(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function comparePendingDrops(a: TwitchDrop, b: TwitchDrop): number {
  const aAutomationOrder = isRewardAutomatable(a) ? 0 : 1;
  const bAutomationOrder = isRewardAutomatable(b) ? 0 : 1;
  if (aAutomationOrder !== bAutomationOrder) return aAutomationOrder - bAutomationOrder;

  const etaOrder = etaOrInfinity(a.remainingMinutes) - etaOrInfinity(b.remainingMinutes);
  if (etaOrder !== 0) {
    return etaOrder;
  }

  const expiryOrder = expiryOrInfinity(a.expiresInMs) - expiryOrInfinity(b.expiresInMs);
  if (expiryOrder !== 0) {
    return expiryOrder;
  }

  if (a.progress !== b.progress) {
    return b.progress - a.progress;
  }

  return a.name.localeCompare(b.name);
}

export function sortPendingDrops(drops: TwitchDrop[]): TwitchDrop[] {
  return [...drops].sort(comparePendingDrops);
}

export function pickNearestDrop(pendingDrops: TwitchDrop[]): TwitchDrop | null {
  if (!Array.isArray(pendingDrops) || pendingDrops.length === 0) {
    return null;
  }
  const farmable = pendingDrops.filter(isRewardAutomatable);
  return farmable.length > 0 ? (sortPendingDrops(farmable)[0] ?? null) : null;
}
