import { dropMatchesGame, gameCategoryKey, gameKey } from '../../shared/game-selection.ts';
import { isRewardAutomatable } from '../../shared/reward-semantics.ts';
import { isExpiredGame } from '../../shared/utils.ts';
import type { TwitchDrop, TwitchGame } from '../../types';

export interface CampaignProgressSummary {
  readonly nextRewardName?: string | null;
  readonly progress?: number | null;
  readonly currentMinutes?: number | null;
  readonly requiredMinutes?: number | null;
  readonly eligibleStreamerCount?: number | null;
}

export type CampaignProgressLookup =
  | ReadonlyMap<string, CampaignProgressSummary>
  | Readonly<Record<string, CampaignProgressSummary>>
  | ((game: TwitchGame) => CampaignProgressSummary | undefined);

export interface CampaignGameGroup {
  readonly key: string;
  readonly name: string;
  readonly imageUrl: string;
  readonly campaigns: readonly TwitchGame[];
}

export type CampaignCatalogSortMode = 'ending-soonest' | 'lowest-availability' | 'alphabetical';
export type CampaignCatalogFilter = 'available' | 'favorites-only' | 'hidden-only' | 'all';

function isMapLike<T>(value: unknown): value is ReadonlyMap<string, T> {
  return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'get') === 'function');
}

function lookupValue<T>(
  lookup: ReadonlyMap<string, T> | Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  if (!lookup) return undefined;
  return isMapLike<T>(lookup) ? lookup.get(key) : lookup[key];
}

export function resolveCampaignProgress(
  lookup: CampaignProgressLookup | undefined,
  game: TwitchGame,
): CampaignProgressSummary | undefined {
  if (!lookup) return undefined;
  return typeof lookup === 'function' ? lookup(game) : lookupValue(lookup, gameKey(game));
}

export function formatCampaignEnd(game: TwitchGame, now: number): string {
  const relativeMs =
    typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)
      ? game.expiresInMs
      : game.endsAt
        ? Date.parse(game.endsAt) - now
        : Number.NaN;
  if (!Number.isFinite(relativeMs)) return 'Ends in unknown time';
  if (relativeMs <= 0) return 'Expired';
  const minutes = Math.max(1, Math.round(relativeMs / 60_000));
  if (minutes < 60) return `Ends in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Ends in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `Ends in ${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
}

export function dropsForCampaign(drops: readonly TwitchDrop[], game: TwitchGame): TwitchDrop[] {
  return drops.filter((drop) => dropMatchesGame(drop, game));
}

export function isCampaignFarmingComplete(game: TwitchGame): boolean {
  return game.allDropsCompleted === true || game.rewardSummary?.completion === 'all-acquired';
}

export function isSubscriptionOnlyCampaign(
  game: TwitchGame,
  drops: readonly TwitchDrop[],
  loaded: boolean,
): boolean {
  const remaining = dropsForCampaign(drops, game).filter((drop) => !drop.claimed);
  if (remaining.length > 0) {
    return remaining.every((drop) => drop.acquisitionMethod === 'subscription');
  }
  return (
    loaded &&
    game.rewardSummary?.completion === 'farming-complete' &&
    game.rewardSummary.remainderReasons.length > 0 &&
    game.rewardSummary.remainderReasons.every((reason) => reason === 'subscription-required')
  );
}

export function isCampaignQueueEligible(
  game: TwitchGame,
  drops: readonly TwitchDrop[],
  loaded: boolean,
): boolean {
  if (isCampaignFarmingComplete(game) || isExpiredGame(game)) return false;
  const remaining = dropsForCampaign(drops, game).filter((drop) => !drop.claimed);
  if (!loaded && remaining.length === 0) return true;
  return remaining.some(isRewardAutomatable);
}

function expiryTime(game: TwitchGame): number {
  const value = game.endsAt ? Date.parse(game.endsAt) : Number.POSITIVE_INFINITY;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function sortCampaignGroups(
  groups: readonly CampaignGameGroup[],
  mode: CampaignCatalogSortMode,
  progressByCampaignKey?: CampaignProgressLookup,
): CampaignGameGroup[] {
  const expiry = (group: CampaignGameGroup) => Math.min(...group.campaigns.map(expiryTime));
  const availability = (group: CampaignGameGroup) =>
    Math.min(
      ...group.campaigns.map(
        (campaign) =>
          resolveCampaignProgress(progressByCampaignKey, campaign)?.eligibleStreamerCount ??
          Number.POSITIVE_INFINITY,
      ),
    );
  return [...groups].sort((left, right) => {
    if (mode === 'alphabetical') return left.name.localeCompare(right.name);
    if (mode === 'lowest-availability') {
      return (
        availability(left) - availability(right) ||
        expiry(left) - expiry(right) ||
        left.name.localeCompare(right.name)
      );
    }
    return (
      expiry(left) - expiry(right) ||
      availability(left) - availability(right) ||
      left.name.localeCompare(right.name)
    );
  });
}

export function groupCampaigns(
  campaigns: readonly TwitchGame[],
  drops: readonly TwitchDrop[],
  query: string,
): CampaignGameGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = new Map<string, TwitchGame[]>();
  for (const campaign of campaigns) {
    const searchable = [
      campaign.name,
      campaign.campaignName,
      campaign.displayName,
      campaign.categorySlug,
      ...dropsForCampaign(drops, campaign).map((drop) => drop.name),
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    if (normalizedQuery && !searchable) continue;
    const key = gameCategoryKey(campaign);
    groups.set(key, [...(groups.get(key) ?? []), campaign]);
  }
  return Array.from(groups, ([key, groupedCampaigns]) => ({
    key,
    name: groupedCampaigns[0]?.name ?? 'Unknown game',
    imageUrl: groupedCampaigns.find((campaign) => campaign.imageUrl)?.imageUrl ?? '',
    campaigns: groupedCampaigns,
  }));
}
