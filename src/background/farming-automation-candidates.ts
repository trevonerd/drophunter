import {
  dropMatchesGame,
  favoriteGameIdentityKeys,
  gameKey,
  isFavoriteGame,
} from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { CampaignAvailability, FarmCategoryScope, TwitchDrop, TwitchGame } from '../types/index.ts';
import { type CampaignPriorityCandidate, orderCampaignCandidates } from './campaign-priority.ts';
import {
  type FavoriteCampaignQueuePlan,
  type FavoriteCampaignQueuePlanInput,
  planFavoriteCampaignQueue,
} from './favorite-games.ts';

export interface FarmingAutomationCandidateFacts {
  readonly hasFarmableReward?: boolean;
  readonly hasStartedReward?: boolean;
  readonly isActive?: boolean;
}

export interface FarmingAutomationPolicySnapshot extends FavoriteCampaignQueuePlanInput {
  readonly campaignAvailabilityByKey: Readonly<Record<string, CampaignAvailability>>;
  readonly farmCategoryScope: FarmCategoryScope;
  readonly candidateFactsByKey?: Readonly<Record<string, FarmingAutomationCandidateFacts>>;
  readonly campaignDropsByKey?: Readonly<Record<string, readonly TwitchDrop[]>>;
  readonly allDrops?: readonly TwitchDrop[];
}

export interface FarmingAutomationCandidate extends CampaignPriorityCandidate {
  readonly hasFarmableReward: boolean;
  readonly isActive: boolean;
  readonly isFavorite: boolean;
}

export interface FarmingAutomationPolicyPlan {
  readonly queue: FavoriteCampaignQueuePlan;
  readonly candidates: readonly FarmingAutomationCandidate[];
  readonly rankedCandidates: readonly FarmingAutomationCandidate[];
}

export interface FarmingAutomationTransitionInput {
  readonly isRunning: boolean;
  readonly rankedCandidates: readonly FarmingAutomationCandidate[];
}

export type FarmingAutomationTransitionDecision =
  | { readonly kind: 'start'; readonly campaign: TwitchGame }
  | {
      readonly kind: 'unchanged';
      readonly reason: 'no-campaign' | 'already-running';
      readonly campaign?: TwitchGame;
    };

function expiryTime(game: TwitchGame): number {
  if (!game.endsAt) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Date.parse(game.endsAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function isExpiredAt(game: TwitchGame, now: number): boolean {
  if (typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)) {
    return game.expiresInMs <= 0;
  }
  const expiry = expiryTime(game);
  return Number.isFinite(expiry) && expiry <= now;
}

function campaignDrops(snapshot: FarmingAutomationPolicySnapshot, game: TwitchGame): readonly TwitchDrop[] {
  const key = gameKey(game);
  const byKey = snapshot.campaignDropsByKey?.[key];
  if (byKey) {
    return byKey;
  }
  return snapshot.allDrops?.filter((drop) => dropMatchesGame(drop, game)) ?? [];
}

function candidateFacts(
  snapshot: FarmingAutomationPolicySnapshot,
  game: TwitchGame,
  now: number,
): FarmingAutomationCandidateFacts {
  const explicit = snapshot.candidateFactsByKey?.[gameKey(game)];
  const drops = campaignDrops(snapshot, game);
  const hasStartedReward =
    explicit?.hasStartedReward ?? drops.some((drop) => drop.progress > 0 && !drop.claimed);
  if (game.rewardSummary?.completion !== 'farmable') {
    return { hasFarmableReward: false, hasStartedReward, isActive: false };
  }
  if (explicit) {
    return explicit;
  }

  return {
    hasFarmableReward:
      drops.length > 0 ? drops.some((drop) => !drop.claimed && isRewardFarmableNow(drop, now)) : true,
    hasStartedReward,
    isActive: !isExpiredAt(game, now),
  };
}

export function deriveFarmingAutomationCandidates(
  snapshot: FarmingAutomationPolicySnapshot,
  now = Date.now(),
): readonly FarmingAutomationCandidate[] {
  const favoriteIds = favoriteGameIdentityKeys(snapshot.favoriteGames);
  return snapshot.availableGames.map((game) => {
    const facts = candidateFacts(snapshot, game, now);
    return {
      game,
      eligibleStreamerCount: snapshot.campaignAvailabilityByKey[gameKey(game)]?.eligibleStreamerCount ?? 0,
      hasStartedReward: facts.hasStartedReward ?? false,
      hasFarmableReward: facts.hasFarmableReward ?? false,
      isActive: facts.isActive ?? !isExpiredAt(game, now),
      isFavorite: isFavoriteGame(game, favoriteIds),
    };
  });
}

export function filterEligibleFarmingAutomationCandidates(
  candidates: readonly FarmingAutomationCandidate[],
): readonly FarmingAutomationCandidate[] {
  return candidates.filter(
    (candidate) => candidate.isActive && candidate.hasFarmableReward && candidate.eligibleStreamerCount > 0,
  );
}

export function rankFarmingAutomationCandidates(
  snapshot: FarmingAutomationPolicySnapshot,
  candidates: readonly FarmingAutomationCandidate[],
): readonly FarmingAutomationCandidate[] {
  const eligible = filterEligibleFarmingAutomationCandidates(candidates);
  const favoriteIds = favoriteGameIdentityKeys(snapshot.favoriteGames);
  const candidateByKey = new Map(eligible.map((candidate) => [gameKey(candidate.game), candidate]));
  return orderCampaignCandidates(eligible, {
    mode: snapshot.campaignPriorityMode,
    scope: snapshot.farmCategoryScope,
    favoriteGameIds: favoriteIds,
    priorityList: snapshot.queue,
  }).flatMap((ranked) => {
    const candidate = candidateByKey.get(gameKey(ranked.game));
    return candidate ? [candidate] : [];
  });
}

export function planFarmingAutomationPolicy(
  snapshot: FarmingAutomationPolicySnapshot,
  now = Date.now(),
): FarmingAutomationPolicyPlan {
  const queue = planFavoriteCampaignQueue(snapshot, now);
  const rankedSnapshot: FarmingAutomationPolicySnapshot = {
    ...snapshot,
    queue: queue.queue,
    queueEntryMetadataByKey: queue.queueEntryMetadataByKey,
  };
  const candidates = deriveFarmingAutomationCandidates(rankedSnapshot, now);
  return {
    queue,
    candidates,
    rankedCandidates: rankFarmingAutomationCandidates(rankedSnapshot, candidates),
  };
}

export function decideFarmingAutomationTransition(
  input: FarmingAutomationTransitionInput,
): FarmingAutomationTransitionDecision {
  const candidate = input.rankedCandidates[0];
  if (!candidate) {
    return { kind: 'unchanged', reason: 'no-campaign' };
  }
  if (!input.isRunning) {
    return { kind: 'start', campaign: candidate.game };
  }

  return { kind: 'unchanged', reason: 'already-running', campaign: candidate.game };
}

export type { FavoriteCampaignAddition, FavoriteCampaignQueuePlan } from './favorite-games.ts';
export { planFavoriteCampaignQueue } from './favorite-games.ts';
