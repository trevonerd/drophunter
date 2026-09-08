import type { TwitchDrop, TwitchGame } from '../../types';
import { logVerboseWarn } from '../logging';
import { isBadgeOrEmoteDrop, isTwitchNativeCampaign } from './campaign-model';
import {
  type ClaimedRewardEntry,
  type ClaimedRewardLookup,
  hasClaimedGameEventReward,
  matchClaimedReward,
  resolveDropClaimedStatus,
} from './claimed-rewards';
import { type InventoryDropMaps, normalizeDropStatus } from './inventory-drops';
import {
  classifyRewardAcquisitionMethod,
  classifyRewardKind,
  computeExpiry,
  extractBenefitDistributionTypes,
  extractBenefitIds,
  extractBenefitNames,
  extractRecordArray,
  getFirstImageUrl,
  normalizeImageUrl,
  normalizeText,
  toIsoDate,
  toNumber,
} from './parsing';

const EMPTY_CONFLICTED_REWARD_BENEFITS: ReadonlySet<string> = new Set();

export function parseCampaignDrops(
  campaign: Record<string, unknown>,
  game: TwitchGame,
  inventoryMaps: InventoryDropMaps,
  claimedRewards: ClaimedRewardLookup,
  globalClaimedRewards: ClaimedRewardEntry,
  conflictedBenefitKeys: ReadonlySet<string> = EMPTY_CONFLICTED_REWARD_BENEFITS,
): TwitchDrop[] {
  const campaignId = normalizeText(campaign.id) || game.campaignId || '';
  const campaignStartsAt = toIsoDate(campaign.startAt);
  const campaignEndsAt = toIsoDate(campaign.endAt);
  if (!('timeBasedDrops' in campaign)) {
    logVerboseWarn('[DropHunter] Expected timeBasedDrops field in campaign response');
    return [];
  }
  const gameClaimedRewards = claimedRewards.get(game.name.toLowerCase());
  return extractRecordArray(campaign.timeBasedDrops).map((drop, index) => {
    const self = (drop.self && typeof drop.self === 'object' ? drop.self : {}) as Record<string, unknown>;
    const parsedDropId = normalizeText(drop.id);
    const inventoryState = campaignId
      ? inventoryMaps.byCampaignDrop.get(`${campaignId}::${parsedDropId}`)
      : parsedDropId
        ? inventoryMaps.byDropId.get(parsedDropId)
        : undefined;
    const claimId =
      inventoryState?.claimId || normalizeText(self.dropInstanceID) || normalizeText(self.dropInstanceId);
    const requiredMinutes =
      inventoryState?.requiredMinutes ?? toNumber(drop.requiredMinutesWatched ?? drop.requiredMinutes);
    const currentMinutes =
      inventoryState?.currentMinutes ??
      toNumber(self.currentMinutesWatched ?? drop.currentMinutesWatched) ??
      0;
    const benefitNames = extractBenefitNames(drop);
    const benefitIds = extractBenefitIds(drop);
    const rewardDistributionTypes = extractBenefitDistributionTypes(drop);
    const rewardKind = classifyRewardKind(rewardDistributionTypes);
    const dropStartsAt = toIsoDate(drop.startAt) ?? campaignStartsAt;
    const dropEndsAt = toIsoDate(drop.endAt) ?? campaignEndsAt;
    const { idMatch, nameMatch, globalIdMatch } = matchClaimedReward(
      benefitIds,
      benefitNames,
      gameClaimedRewards,
      globalClaimedRewards,
      { startsAt: dropStartsAt, endsAt: dropEndsAt },
      true,
      isBadgeOrEmoteDrop(drop) || isTwitchNativeCampaign(campaign),
    );
    const isEarlyAwardable = rewardKind === 'twitch-badge' || rewardKind === 'twitch-emote';
    const strictClaimedFromGameEvents = isEarlyAwardable
      ? hasClaimedGameEventReward(claimedRewards, {
          benefitIds,
          gameName: game.name,
          window: { startsAt: dropStartsAt, endsAt: dropEndsAt },
          conflictedBenefitKeys,
        })
      : false;
    const claimed = resolveDropClaimedStatus(
      inventoryState?.claimed ?? Boolean(self.isClaimed ?? drop.isClaimed),
      idMatch || nameMatch || globalIdMatch,
      strictClaimedFromGameEvents,
      inventoryState != null,
      isEarlyAwardable,
    );
    const claimableFromApi =
      !claimed && (inventoryState?.claimable ?? Boolean(self.isClaimable ?? self.canClaim));
    const earnedFromProgress = Boolean(
      requiredMinutes !== null && requiredMinutes > 0 && currentMinutes >= requiredMinutes,
    );
    const claimable = claimableFromApi || (Boolean(claimId) && !claimed);
    const progress =
      claimed || claimable || earnedFromProgress
        ? 100
        : requiredMinutes && requiredMinutes > 0
          ? Math.max(0, Math.min(100, Math.floor((currentMinutes / requiredMinutes) * 100)))
          : 0;
    const remainingMinutes =
      claimed || claimable || earnedFromProgress || requiredMinutes === null
        ? 0
        : Math.max(0, Math.round(requiredMinutes - currentMinutes));
    const endsAt = inventoryState?.endsAt ?? toIsoDate(drop.endAt) ?? campaignEndsAt;
    return {
      id: parsedDropId || claimId || `${game.id}-drop-${index + 1}`,
      claimId: claimId || undefined,
      name: normalizeText(drop.name) || `Drop ${index + 1}`,
      gameId: game.id,
      gameName: game.name,
      imageUrl: normalizeImageUrl(getFirstImageUrl(drop)) || game.imageUrl,
      categorySlug: game.categorySlug,
      progress,
      currentMinutes,
      claimed,
      claimable,
      campaignId: campaignId || undefined,
      startsAt: dropStartsAt,
      endsAt,
      expiresInMs: computeExpiry(endsAt).expiresInMs,
      status: normalizeDropStatus(progress, claimed, claimable),
      requiredMinutes,
      remainingMinutes,
      progressSource: 'campaign',
      acquisitionMethod: classifyRewardAcquisitionMethod(requiredMinutes, 'unknown'),
      rewardKind,
      verificationState: strictClaimedFromGameEvents ? 'verified' : 'unassessed',
      benefitIds,
      rewardDistributionTypes,
    } satisfies TwitchDrop;
  });
}

export function parseEventBasedDrops(
  campaign: Record<string, unknown>,
  game: TwitchGame,
  claimedRewards: ClaimedRewardLookup,
  globalClaimedRewards: ClaimedRewardEntry,
  conflictedBenefitKeys: ReadonlySet<string> = EMPTY_CONFLICTED_REWARD_BENEFITS,
): TwitchDrop[] {
  const campaignId = normalizeText(campaign.id) || game.campaignId || '';
  const campaignStartsAt = toIsoDate(campaign.startAt);
  const campaignEndsAt = toIsoDate(campaign.endAt);
  const gameClaimedRewards = claimedRewards.get(game.name.toLowerCase());
  return extractRecordArray(campaign.eventBasedDrops).map((drop, index) => {
    const benefitNames = extractBenefitNames(drop);
    const benefitIds = extractBenefitIds(drop);
    const rewardDistributionTypes = extractBenefitDistributionTypes(drop);
    const rewardKind = classifyRewardKind(rewardDistributionTypes);
    const dropStartsAt = toIsoDate(drop.startAt) ?? campaignStartsAt;
    const dropEndsAt = toIsoDate(drop.endAt) ?? campaignEndsAt;
    const { idMatch, nameMatch, globalIdMatch } = matchClaimedReward(
      benefitIds,
      benefitNames,
      gameClaimedRewards,
      globalClaimedRewards,
      { startsAt: dropStartsAt, endsAt: dropEndsAt },
      true,
      isBadgeOrEmoteDrop(drop) || isTwitchNativeCampaign(campaign),
    );
    const isEarlyAwardable = rewardKind === 'twitch-badge' || rewardKind === 'twitch-emote';
    const strictClaimedFromGameEvents = isEarlyAwardable
      ? hasClaimedGameEventReward(claimedRewards, {
          benefitIds,
          gameName: game.name,
          window: { startsAt: dropStartsAt, endsAt: dropEndsAt },
          conflictedBenefitKeys,
        })
      : false;
    const claimed = resolveDropClaimedStatus(
      false,
      idMatch || nameMatch || globalIdMatch,
      strictClaimedFromGameEvents,
      false,
      isEarlyAwardable,
    );
    const endsAt = toIsoDate(drop.endAt) ?? campaignEndsAt;
    const progress = claimed ? 100 : 0;
    return {
      id: normalizeText(drop.id) || `${game.id}-event-drop-${index + 1}`,
      name: normalizeText(drop.name) || `Event Drop ${index + 1}`,
      gameId: game.id,
      gameName: game.name,
      imageUrl: normalizeImageUrl(getFirstImageUrl(drop)) || game.imageUrl,
      categorySlug: game.categorySlug,
      progress,
      currentMinutes: 0,
      claimed,
      claimable: false,
      campaignId: campaignId || undefined,
      startsAt: dropStartsAt,
      endsAt,
      expiresInMs: computeExpiry(endsAt).expiresInMs,
      status: normalizeDropStatus(progress, claimed, false),
      requiredMinutes: null,
      remainingMinutes: null,
      progressSource: 'campaign',
      acquisitionMethod: classifyRewardAcquisitionMethod(null, 'subscription'),
      rewardKind,
      verificationState: strictClaimedFromGameEvents ? 'verified' : 'unassessed',
      benefitIds,
      rewardDistributionTypes,
    } satisfies TwitchDrop;
  });
}
