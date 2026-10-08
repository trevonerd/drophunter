import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import {
  favoriteGameIdentityKeys,
  gameCategoryIdentityKeys,
  gameCategoryKey,
  gameKey,
} from '../shared/game-selection.ts';
import { isRewardFarmableNow, isRewardScheduledForFuture } from '../shared/reward-scheduling.ts';
import type {
  AppState,
  CampaignPriorityMode,
  FavoriteGame,
  GamePreference,
  HiddenGame,
  QueueAcquisitionRound,
  QueueEntryMetadata,
  TwitchDrop,
  TwitchGame,
} from '../types/index.ts';
import { compareCampaignDeadlines, insertCampaignByDeadline } from './campaign-priority.ts';
import {
  automaticFavoriteQueueMetadata,
  categoryAliases,
  matchingFavoriteKey,
  planQueueMetadata,
  preferenceEntryMatches,
  reconcileQueueEntryMetadata,
  type SetGamePreferenceResult,
  setGameFavorite,
} from './favorite-campaign-queue-helpers.ts';

export type { SetGamePreferenceResult } from './favorite-campaign-queue-helpers.ts';
export { reconcileQueueEntryMetadata, setGameFavorite } from './favorite-campaign-queue-helpers.ts';

export interface FavoriteCampaignAddition {
  readonly game: TwitchGame;
  readonly position: number;
}

export interface FavoriteCampaignQueuePlanInput {
  readonly campaignDropsByKey?: Readonly<Record<string, readonly TwitchDrop[]>>;
  readonly availableGames: readonly TwitchGame[];
  readonly favoriteGames: readonly FavoriteGame[];
  readonly hiddenGames?: readonly HiddenGame[];
  readonly queue: readonly TwitchGame[];
  readonly queueEntryMetadataByKey: Readonly<Record<string, QueueEntryMetadata>>;
  readonly campaignPriorityMode: CampaignPriorityMode;
  readonly queueAcquisitionRound?: QueueAcquisitionRound | null;
  /** The active campaign remains at the queue head until a transition preempts it. */
  readonly isRunning?: boolean;
  readonly selectedGame?: TwitchGame | null;
}

export interface FavoriteCampaignQueuePlan {
  readonly queue: readonly TwitchGame[];
  readonly queueEntryMetadataByKey: Readonly<Record<string, QueueEntryMetadata>>;
  readonly added: readonly FavoriteCampaignAddition[];
}

export function planFavoriteCampaignQueue(
  input: FavoriteCampaignQueuePlanInput,
  now: number,
): FavoriteCampaignQueuePlan {
  const originalQueueKeys = new Set(input.queue.map(gameKey));
  const hiddenIds = new Set(
    (input.hiddenGames ?? []).flatMap((hidden) => [hidden.gameId, ...(hidden.identityKeys ?? [])]),
  );
  const originalMetadata = planQueueMetadata(input.queue, input.queueEntryMetadataByKey, now);
  const canonical = new Map(input.availableGames.map((game) => [gameKey(game), game]));
  const retainedQueue = input.queue
    .map((game) => canonical.get(gameKey(game)) ?? game)
    .filter(
      (game) =>
        campaignRejectionReason(game, now) === null &&
        (originalMetadata[gameKey(game)]?.source !== 'favorite-auto' ||
          gameCategoryIdentityKeys(game).some((key) => hiddenIds.has(key))),
    );
  const favoriteIds = favoriteGameIdentityKeys(input.favoriteGames);
  const selectedKey = input.isRunning && input.selectedGame ? gameKey(input.selectedGame) : null;
  const attemptedKeys = new Set(input.queueAcquisitionRound?.attemptedCampaignKeys ?? []);
  const active = selectedKey ? retainedQueue.find((game) => gameKey(game) === selectedKey) : undefined;
  const retainedWithoutActive = retainedQueue.filter((game) => gameKey(game) !== selectedKey);
  const queue =
    input.campaignPriorityMode === 'priority-list-only'
      ? [...retainedQueue]
      : [
          ...(active ? [active] : []),
          ...retainedWithoutActive.sort((left, right) => {
            const leftAttempted = attemptedKeys.has(gameKey(left));
            const rightAttempted = attemptedKeys.has(gameKey(right));
            return leftAttempted === rightAttempted
              ? leftAttempted
                ? 0
                : compareCampaignDeadlines(left, right, favoriteIds)
              : Number(leftAttempted) - Number(rightAttempted);
          }),
        ];
  const queueEntryMetadataByKey = planQueueMetadata(queue, originalMetadata, now);
  for (const game of queue) {
    const key = gameKey(game);
    const metadata = queueEntryMetadataByKey[key];
    if (
      metadata?.source === 'favorite-auto' &&
      gameCategoryIdentityKeys(game).some((identityKey) => hiddenIds.has(identityKey))
    ) {
      queueEntryMetadataByKey[key] = {
        ...metadata,
        source: 'manual',
        reason: 'retained-after-hide',
      };
    }
  }
  const queuedKeys = new Set(queue.map(gameKey));
  const candidates = input.availableGames
    .flatMap((game) => {
      if (gameCategoryIdentityKeys(game).some((key) => hiddenIds.has(key))) return [];
      const knownDrops = input.campaignDropsByKey?.[gameKey(game)];
      const hasPotentialReward =
        knownDrops === undefined ||
        knownDrops.some((drop) => isRewardFarmableNow(drop, now) || isRewardScheduledForFuture(drop, now));
      return matchingFavoriteKey(game, input.favoriteGames) !== null &&
        !queuedKeys.has(gameKey(game)) &&
        campaignRejectionReason(game, now) === null &&
        hasPotentialReward &&
        game.rewardSummary?.completion === 'farmable'
        ? [game]
        : [];
    })
    .sort(compareCampaignDeadlines);

  const added: FavoriteCampaignAddition[] = [];
  let plannedQueue = queue;
  for (const game of candidates) {
    if (queuedKeys.has(gameKey(game))) continue;
    const parkedStart =
      input.campaignPriorityMode === 'priority-list-only'
        ? -1
        : plannedQueue.findIndex(
            (entry, index) => index >= (active ? 1 : 0) && attemptedKeys.has(gameKey(entry)),
          );
    const eligibleQueue = parkedStart < 0 ? plannedQueue : plannedQueue.slice(0, parkedStart);
    const insertion = insertCampaignByDeadline(eligibleQueue, game, active ? 1 : 0, favoriteIds);
    plannedQueue = [...insertion.queue, ...(parkedStart < 0 ? [] : plannedQueue.slice(parkedStart))];
    const key = gameKey(game);
    queueEntryMetadataByKey[key] = originalMetadata[key] ?? automaticFavoriteQueueMetadata(now);
    queuedKeys.add(key);
    if (!originalQueueKeys.has(key)) {
      added.push({ game, position: insertion.position });
    }
  }

  const activeCampaign = selectedKey
    ? (plannedQueue.find((campaign) => gameKey(campaign) === selectedKey) ?? input.selectedGame)
    : null;
  const queueWithActiveCampaign =
    activeCampaign &&
    campaignRejectionReason(canonical.get(gameKey(activeCampaign)) ?? activeCampaign, now) === null
      ? [activeCampaign, ...plannedQueue.filter((campaign) => gameKey(campaign) !== selectedKey)]
      : plannedQueue;
  return {
    queue: queueWithActiveCampaign,
    queueEntryMetadataByKey: planQueueMetadata(queueWithActiveCampaign, queueEntryMetadataByKey, now),
    added,
  };
}

export function setGamePreference(
  state: AppState,
  game: TwitchGame,
  preference: GamePreference,
  now: number,
): SetGamePreferenceResult {
  const aliases = categoryAliases(state, game);
  const hidden = state.hiddenGames.find((entry) => preferenceEntryMatches(entry, aliases));

  if (preference === 'hidden') {
    const wasFavorite = state.favoriteGames.some((entry) => preferenceEntryMatches(entry, aliases));
    state.favoriteGames = state.favoriteGames.filter((entry) => !preferenceEntryMatches(entry, aliases));
    state.hiddenGames = [
      ...state.hiddenGames.filter((entry) => !preferenceEntryMatches(entry, aliases)),
      {
        gameId: gameCategoryKey(game),
        lastKnownName: game.name,
        hiddenAt: hidden?.hiddenAt ?? now,
        identityKeys: Array.from(new Set([...(hidden?.identityKeys ?? []), ...aliases])),
      },
    ];
    let retainedQueueEntries = 0;
    state.queueEntryMetadataByKey = Object.fromEntries(
      Object.entries(state.queueEntryMetadataByKey).map(([key, metadata]) => {
        const queuedGame = state.queue.find((candidate) => gameKey(candidate) === key);
        if (
          queuedGame &&
          preferenceEntryMatches(
            { gameId: gameCategoryKey(queuedGame), identityKeys: gameCategoryIdentityKeys(queuedGame) },
            aliases,
          ) &&
          metadata.source === 'favorite-auto'
        ) {
          retainedQueueEntries += 1;
          return [key, { ...metadata, source: 'manual' as const, reason: 'retained-after-hide' as const }];
        }
        return [key, metadata];
      }),
    );
    return {
      changed: hidden === undefined || wasFavorite,
      preference,
      removedQueueEntries: 0,
      retainedQueueEntries,
    };
  }

  state.hiddenGames = state.hiddenGames.filter((entry) => !preferenceEntryMatches(entry, aliases));
  const favoriteResult = setGameFavorite(state, game, preference === 'favorite', now);
  return {
    changed: hidden !== undefined || favoriteResult.changed,
    preference,
    removedQueueEntries: favoriteResult.removedQueueEntries,
    retainedQueueEntries: 0,
  };
}

export function discoverFavoriteCampaigns(
  state: AppState,
  now: number,
): { readonly added: FavoriteCampaignAddition[] } {
  reconcileQueueEntryMetadata(state, now);
  const plan = planFavoriteCampaignQueue(state, now);
  state.queue = [...plan.queue];
  state.queueEntryMetadataByKey = { ...plan.queueEntryMetadataByKey };
  return { added: [...plan.added] };
}
