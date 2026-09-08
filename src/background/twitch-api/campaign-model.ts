import { toSlug } from '../../shared/utils';
import type { TwitchGame } from '../../types';
import {
  computeExpiry,
  extractBenefitDistributionTypes,
  extractRecordArray,
  normalizeImageUrl,
  normalizeText,
  toIsoDate,
} from './parsing';

export function extractCampaignRewardDrops(campaign: Record<string, unknown>): Record<string, unknown>[] {
  return [...extractRecordArray(campaign.timeBasedDrops), ...extractRecordArray(campaign.eventBasedDrops)];
}

export function isBadgeOrEmoteDrop(drop: Record<string, unknown>): boolean {
  return extractBenefitDistributionTypes(drop).some((type) => type === 'BADGE' || type === 'EMOTE');
}

export function isTwitchNativeCampaign(campaign: Record<string, unknown>): boolean {
  return extractCampaignRewardDrops(campaign).some((drop) => isBadgeOrEmoteDrop(drop));
}

export function isCampaignUsable(campaign: Record<string, unknown>): boolean {
  const status = normalizeText(campaign.status).toUpperCase();
  return !status || (status !== 'EXPIRED' && status !== 'INVALID' && status !== 'CLOSED');
}

function accountLinkUrl(value: unknown): string | undefined {
  const raw = normalizeText(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && hostname !== 'twitch.tv' && !hostname.endsWith('.twitch.tv')
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseGameFromCampaign(campaign: Record<string, unknown>): TwitchGame | null {
  const gameRaw = campaign.game;
  if (!gameRaw || typeof gameRaw !== 'object') return null;
  const game = gameRaw as Record<string, unknown>;
  const campaignId = normalizeText(campaign.id);
  const gameName = normalizeText(game.displayName) || normalizeText(game.name);
  if (!gameName) return null;
  const allow = campaign.allow;
  const channels = allow && typeof allow === 'object' ? (allow as Record<string, unknown>).channels : [];
  const allowedChannels = Array.isArray(channels)
    ? channels.flatMap((channel) => {
        if (!channel || typeof channel !== 'object') return [];
        const name = normalizeText((channel as Record<string, unknown>).name).toLowerCase();
        return name ? [name] : [];
      })
    : [];
  const endsAt = toIsoDate(campaign.endAt);
  const self = campaign.self;
  const connected =
    !self ||
    typeof self !== 'object' ||
    (self as Record<string, unknown>).isAccountConnected !== false ||
    isTwitchNativeCampaign(campaign);
  return {
    id: campaignId ? `campaign-${campaignId}` : `game-${toSlug(gameName)}`,
    name: gameName,
    displayName: gameName,
    campaignName:
      normalizeText(campaign.name) ||
      normalizeText(campaign.displayName) ||
      normalizeText(campaign.title) ||
      undefined,
    imageUrl: normalizeImageUrl(game.boxArtURL) || normalizeImageUrl(game.boxArtUrl),
    categoryId: normalizeText(game.id) || undefined,
    categorySlug: normalizeText(game.slug) || undefined,
    campaignId: campaignId || undefined,
    accountLinkUrl: accountLinkUrl(campaign.accountLinkURL ?? campaign.accountLinkUrl),
    endsAt,
    ...computeExpiry(endsAt),
    dropCount: 0,
    isConnected: connected,
    allowedChannels: allowedChannels.length > 0 ? allowedChannels : null,
  };
}
