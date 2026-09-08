import type { DropStatus, TwitchDrop } from '../../types';
import { logVerboseWarn } from '../logging';
import { computeExpiry, extractRecordArray, normalizeText, toIsoDate, toNumber } from './parsing';

export interface InventoryDropState {
  campaignId: string;
  dropId: string;
  claimId?: string;
  requiredMinutes: number | null;
  currentMinutes: number;
  claimed: boolean;
  claimable: boolean;
  endsAt: string | null;
}

export interface InventoryDropMaps {
  byCampaignDrop: Map<string, InventoryDropState>;
  byDropId: Map<string, InventoryDropState>;
}

export function normalizeDropStatus(progress: number, claimed: boolean, claimable: boolean): DropStatus {
  if (claimed || (progress >= 100 && !claimable)) return 'completed';
  return progress > 0 || claimable ? 'active' : 'pending';
}

export function buildInventoryDropMaps(inventoryRaw: unknown): InventoryDropMaps {
  const byCampaignDrop = new Map<string, InventoryDropState>();
  const byDropId = new Map<string, InventoryDropState>();
  if (!inventoryRaw || typeof inventoryRaw !== 'object') return { byCampaignDrop, byDropId };
  const inventory = inventoryRaw as Record<string, unknown>;
  if (!('dropCampaignsInProgress' in inventory)) {
    logVerboseWarn('[DropHunter] Expected dropCampaignsInProgress field in inventory response');
    return { byCampaignDrop, byDropId };
  }
  extractRecordArray(inventory.dropCampaignsInProgress).forEach((campaign) => {
    const campaignId = normalizeText(campaign.id);
    if (!campaignId) return;
    extractRecordArray(campaign.timeBasedDrops).forEach((drop) => {
      const dropId = normalizeText(drop.id);
      if (!dropId) return;
      const self = (drop.self && typeof drop.self === 'object' ? drop.self : {}) as Record<string, unknown>;
      const state: InventoryDropState = {
        campaignId,
        dropId,
        claimId: normalizeText(self.dropInstanceID) || normalizeText(self.dropInstanceId) || undefined,
        requiredMinutes: toNumber(drop.requiredMinutesWatched ?? drop.requiredMinutes),
        currentMinutes: Math.max(0, toNumber(self.currentMinutesWatched ?? drop.currentMinutesWatched) ?? 0),
        claimed: Boolean(self.isClaimed ?? drop.isClaimed),
        claimable: Boolean(self.isClaimable ?? self.canClaim),
        endsAt: toIsoDate(drop.endAt),
      };
      byCampaignDrop.set(`${campaignId}::${dropId}`, state);
      byDropId.set(dropId, state);
    });
  });
  return { byCampaignDrop, byDropId };
}

export function findInventoryStateForDrop(
  drop: TwitchDrop,
  inventoryMaps: InventoryDropMaps,
): InventoryDropState | undefined {
  const dropId = normalizeText(drop.id);
  if (!dropId) return undefined;
  const campaignId = normalizeText(drop.campaignId);
  return campaignId
    ? inventoryMaps.byCampaignDrop.get(`${campaignId}::${dropId}`)
    : inventoryMaps.byDropId.get(dropId);
}

function applyInventoryStateToDrop(drop: TwitchDrop, inventoryMaps: InventoryDropMaps): TwitchDrop {
  const inventoryState = findInventoryStateForDrop(drop, inventoryMaps);
  if (!inventoryState) return drop;
  const requiredMinutes = inventoryState.requiredMinutes ?? drop.requiredMinutes ?? null;
  const currentMinutes = inventoryState.currentMinutes;
  const claimed = drop.claimed || inventoryState.claimed;
  const claimId = inventoryState.claimId ?? drop.claimId;
  const claimable = (!claimed && inventoryState.claimable) || (Boolean(claimId) && !claimed);
  const earnedFromProgress = Boolean(
    requiredMinutes && requiredMinutes > 0 && currentMinutes >= requiredMinutes,
  );
  const progress =
    claimed || claimable || earnedFromProgress
      ? 100
      : requiredMinutes && requiredMinutes > 0
        ? Math.max(0, Math.min(100, Math.floor((currentMinutes / requiredMinutes) * 100)))
        : drop.progress;
  const remainingMinutes =
    claimed || claimable || earnedFromProgress || requiredMinutes === null
      ? 0
      : Math.max(0, Math.round(requiredMinutes - currentMinutes));
  const endsAt = inventoryState.endsAt ?? drop.endsAt ?? null;
  return {
    ...drop,
    claimId,
    currentMinutes,
    claimed,
    claimable,
    progress,
    status: normalizeDropStatus(progress, claimed, claimable),
    requiredMinutes,
    remainingMinutes,
    endsAt,
    expiresInMs: computeExpiry(endsAt).expiresInMs,
    progressSource: 'inventory',
  };
}

export function applyInventoryToDrops(drops: TwitchDrop[], inventoryRaw: unknown): TwitchDrop[] {
  const inventoryMaps = buildInventoryDropMaps(inventoryRaw);
  return inventoryMaps.byCampaignDrop.size === 0 && inventoryMaps.byDropId.size === 0
    ? drops
    : drops.map((drop) => applyInventoryStateToDrop(drop, inventoryMaps));
}
