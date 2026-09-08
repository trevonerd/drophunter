import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../../types';
import { parseCampaignDrops, parseEventBasedDrops } from './campaign-drop-parsing';
import { extractCampaignRewardDrops, isCampaignUsable, parseGameFromCampaign } from './campaign-model';
import type { ClaimedRewardEntry, ClaimedRewardLookup } from './claimed-rewards';
import type { InventoryDropMaps } from './inventory-drops';
import {
  buildConflictedRewardBenefitKeys,
  extractBenefitIds,
  extractRecordArray,
  normalizeText,
} from './parsing';

export interface VerifiedCampaigns {
  readonly campaigns: Record<string, unknown>[];
  readonly verified: boolean;
}

export interface SnapshotCompositionContext {
  readonly campaigns: readonly Record<string, unknown>[];
  readonly usableCampaigns: readonly Record<string, unknown>[];
  readonly dashboardCampaignIds: readonly string[];
  readonly inventoryVerified: boolean;
  readonly inventoryMaps: InventoryDropMaps;
  readonly claimedRewards: ClaimedRewardLookup;
  readonly globalClaimedRewards: ClaimedRewardEntry;
}

export function extractVerifiedCampaigns(value: unknown): VerifiedCampaigns {
  const currentUser =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).currentUser
      : null;
  const campaignList =
    currentUser && typeof currentUser === 'object' && !Array.isArray(currentUser)
      ? (currentUser as Record<string, unknown>).dropCampaigns
      : null;
  const campaigns = extractRecordArray(campaignList);
  return {
    campaigns,
    verified:
      Array.isArray(campaignList) &&
      campaigns.length === campaignList.length &&
      campaigns.every((campaign) => normalizeText(campaign.id).length > 0),
  };
}

export function hasVerifiedInventory(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).dropCampaignsInProgress)
  );
}

export function orderCampaignDetails(
  campaigns: readonly Record<string, unknown>[],
  priorityGameIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  const isPriority = (campaign: Record<string, unknown>): boolean => {
    if (priorityGameIds.size === 0) return false;
    const game = campaign.game;
    if (!game || typeof game !== 'object') return false;
    const gameRecord = game as Record<string, unknown>;
    return [gameRecord.id, gameRecord.slug, gameRecord.name, gameRecord.displayName]
      .map(normalizeText)
      .some((value) => priorityGameIds.has(value));
  };
  return [...campaigns]
    .filter(isCampaignUsable)
    .sort((left, right) => Number(isPriority(right)) - Number(isPriority(left)));
}

export function campaignDetailsVerified(
  usableCampaigns: readonly Record<string, unknown>[],
  campaignIds: readonly string[],
  detailsMap: ReadonlyMap<string, Record<string, unknown>>,
  failedBatches: number,
): boolean {
  return (
    failedBatches === 0 &&
    detailsMap.size === campaignIds.length &&
    usableCampaigns.every((campaign) => {
      const campaignId = normalizeText(campaign.id);
      const details = detailsMap.get(campaignId);
      return details !== undefined && parseGameFromCampaign({ ...campaign, ...details }) !== null;
    })
  );
}

export function composeDropsSnapshot(
  context: SnapshotCompositionContext,
  detailsMap: ReadonlyMap<string, Record<string, unknown>>,
  campaignsVerified = false,
): DropsSnapshot {
  // A progressive batch cannot rule out another campaign sharing a game-less
  // benefit. Only the verified final snapshot can establish that uniqueness.
  const claimedRewards = campaignsVerified
    ? context.claimedRewards
    : new Map([...context.claimedRewards].filter(([gameName]) => gameName !== null));
  const parsedCampaigns = context.usableCampaigns.flatMap((campaign, index) => {
    const campaignId = normalizeText(campaign.id);
    const mergedCampaign =
      campaignId && detailsMap.has(campaignId) ? { ...campaign, ...detailsMap.get(campaignId) } : campaign;
    const game = parseGameFromCampaign(mergedCampaign);
    return game
      ? [{ campaign: mergedCampaign, game, campaignIdentity: campaignId || `${game.id}-${index}` }]
      : [];
  });
  const conflictedBenefitKeys = buildConflictedRewardBenefitKeys(
    parsedCampaigns.flatMap(({ campaign, game, campaignIdentity }) =>
      extractCampaignRewardDrops(campaign).map((drop) => ({
        gameName: game.name,
        campaignIdentity,
        benefitIds: extractBenefitIds(drop),
      })),
    ),
  );
  const games: TwitchGame[] = [];
  const drops: TwitchDrop[] = [];
  const campaignChannelsMap: Record<string, string[] | null> = {};
  parsedCampaigns.forEach(({ campaign, game }) => {
    const campaignId = normalizeText(campaign.id);
    if (campaignId) campaignChannelsMap[campaignId] = game.allowedChannels ?? null;
    const campaignDrops = parseCampaignDrops(
      campaign,
      game,
      context.inventoryMaps,
      claimedRewards,
      context.globalClaimedRewards,
      conflictedBenefitKeys,
    );
    const eventDrops = parseEventBasedDrops(
      campaign,
      game,
      claimedRewards,
      context.globalClaimedRewards,
      conflictedBenefitKeys,
    );
    const allCampaignDrops = [...campaignDrops, ...eventDrops];
    if (allCampaignDrops.length > 0) games.push({ ...game, dropCount: allCampaignDrops.length });
    drops.push(...allCampaignDrops);
  });
  return {
    games,
    drops,
    campaignChannelsMap,
    inventoryVerified: context.inventoryVerified,
    campaignsVerified,
    ...(campaignsVerified ? { authoritativeCampaignIds: [...context.dashboardCampaignIds] } : {}),
    updatedAt: Date.now(),
  };
}
