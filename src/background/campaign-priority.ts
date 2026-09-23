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

export function expiryTime(game: TwitchGame): number {
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

export function compareCampaignDeadlines(left: TwitchGame, right: TwitchGame): number {
  return expiryTime(left) - expiryTime(right) || gameKey(left).localeCompare(gameKey(right));
}

export function insertCampaignByDeadline(
  queue: readonly TwitchGame[],
  campaign: TwitchGame,
  minimumIndex = 0,
): { readonly queue: TwitchGame[]; readonly position: number } {
  const existingIndex = queue.findIndex((entry) => gameKey(entry) === gameKey(campaign));
  if (existingIndex >= 0) {
    return { queue: [...queue], position: existingIndex + 1 };
  }

  const start = Math.max(0, Math.min(minimumIndex, queue.length));
  let index = start;
  let fewestInversions = Number.POSITIVE_INFINITY;
  for (let candidateIndex = start; candidateIndex <= queue.length; candidateIndex += 1) {
    let inversions = 0;
    for (let existingIndex = start; existingIndex < queue.length; existingIndex += 1) {
      const existing = queue[existingIndex];
      if (!existing) continue;
      const order = compareCampaignDeadlines(existing, campaign);
      if ((existingIndex < candidateIndex && order > 0) || (existingIndex >= candidateIndex && order < 0)) {
        inversions += 1;
      }
    }
    if (inversions < fewestInversions) {
      fewestInversions = inversions;
      index = candidateIndex;
    }
  }
  const result = [...queue];
  result.splice(index, 0, campaign);
  return { queue: result, position: index + 1 };
}

export const insertFavoriteCampaignByDeadline = insertCampaignByDeadline;
