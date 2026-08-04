import { gameKey, isFavoriteGame } from '../shared/game-selection.ts';
import type { CampaignPriorityMode, FarmCategoryScope, TwitchGame } from '../types/index.ts';

export interface CampaignPriorityCandidate {
  readonly game: TwitchGame;
  readonly eligibleStreamerCount: number;
  readonly hasStartedReward: boolean;
}

export interface RankedCampaign extends CampaignPriorityCandidate {
  readonly positionReason: string;
}

export interface CampaignPriorityOptions {
  readonly mode: CampaignPriorityMode;
  readonly scope: FarmCategoryScope;
  readonly favoriteGameIds: ReadonlySet<string>;
  readonly priorityList: readonly TwitchGame[];
}

function expiryTime(game: TwitchGame): number {
  if (!game.endsAt) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(game.endsAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareStarted(left: CampaignPriorityCandidate, right: CampaignPriorityCandidate): number {
  return Number(right.hasStartedReward) - Number(left.hasStartedReward);
}

function compareCampaignId(left: CampaignPriorityCandidate, right: CampaignPriorityCandidate): number {
  return (left.game.campaignId ?? gameKey(left.game)).localeCompare(
    right.game.campaignId ?? gameKey(right.game),
  );
}

function compareEndingSoonest(left: CampaignPriorityCandidate, right: CampaignPriorityCandidate): number {
  return (
    expiryTime(left.game) - expiryTime(right.game) ||
    compareStarted(left, right) ||
    left.eligibleStreamerCount - right.eligibleStreamerCount ||
    compareCampaignId(left, right)
  );
}

function compareLowestAvailability(
  left: CampaignPriorityCandidate,
  right: CampaignPriorityCandidate,
): number {
  return (
    left.eligibleStreamerCount - right.eligibleStreamerCount ||
    expiryTime(left.game) - expiryTime(right.game) ||
    compareStarted(left, right) ||
    compareCampaignId(left, right)
  );
}

function reasonFor(candidate: CampaignPriorityCandidate, mode: CampaignPriorityMode): string {
  if (mode === 'priority-list-only') {
    return 'This campaign follows your priority list.';
  }
  if (mode === 'lowest-availability') {
    const count = candidate.eligibleStreamerCount;
    return `${count} eligible live ${count === 1 ? 'channel' : 'channels'} available.`;
  }
  return candidate.hasStartedReward
    ? 'This campaign ends first and already has progress.'
    : 'This campaign ends first.';
}

export function orderCampaignCandidates(
  candidates: readonly CampaignPriorityCandidate[],
  options: CampaignPriorityOptions,
): RankedCampaign[] {
  const scoped =
    options.scope === 'favorites-only'
      ? candidates.filter((candidate) => isFavoriteGame(candidate.game, options.favoriteGameIds))
      : [...candidates];

  if (options.mode === 'priority-list-only') {
    const candidateByKey = new Map(scoped.map((candidate) => [gameKey(candidate.game), candidate]));
    return options.priorityList.flatMap((game) => {
      const candidate = candidateByKey.get(gameKey(game));
      return candidate ? [{ ...candidate, positionReason: reasonFor(candidate, options.mode) }] : [];
    });
  }

  const compare = options.mode === 'lowest-availability' ? compareLowestAvailability : compareEndingSoonest;
  return [...scoped]
    .sort(compare)
    .map((candidate) => ({ ...candidate, positionReason: reasonFor(candidate, options.mode) }));
}

export function insertFavoriteCampaignByDeadline(
  queue: readonly TwitchGame[],
  favoriteCampaign: TwitchGame,
): { readonly queue: TwitchGame[]; readonly position: number } {
  const existingIndex = queue.findIndex((entry) => gameKey(entry) === gameKey(favoriteCampaign));
  if (existingIndex >= 0) {
    return { queue: [...queue], position: existingIndex + 1 };
  }

  const favoriteExpiry = expiryTime(favoriteCampaign);
  const insertionIndex = queue.findIndex((entry) => expiryTime(entry) > favoriteExpiry);
  const index = insertionIndex >= 0 ? insertionIndex : queue.length;
  const result = [...queue];
  result.splice(index, 0, favoriteCampaign);
  return { queue: result, position: index + 1 };
}

export function shouldPreemptForFavorite(
  currentCampaign: TwitchGame,
  newFavoriteCampaign: TwitchGame,
): boolean {
  const currentExpiry = expiryTime(currentCampaign);
  const favoriteExpiry = expiryTime(newFavoriteCampaign);
  return Number.isFinite(currentExpiry) && Number.isFinite(favoriteExpiry) && favoriteExpiry < currentExpiry;
}
