import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameCategoryIdentityKeys, gameCategoryKey, gameKey } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type {
  AppState,
  CampaignPriorityMode,
  FavoriteGame,
  GamePreference,
  HiddenGame,
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
} from './favorite-campaign-queue-helpers.ts';

export type { SetGamePreferenceResult } from './favorite-campaign-queue-helpers.ts';
export { reconcileQueueEntryMetadata } from './favorite-campaign-queue-helpers.ts';

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
  const selectedKey = input.isRunning && input.selectedGame ? gameKey(input.selectedGame) : null;
  const active = selectedKey ? retainedQueue.find((game) => gameKey(game) === selectedKey) : undefined;
  const retainedWithoutActive = retainedQueue.filter((game) => gameKey(game) !== selectedKey);
  const queue =
    input.campaignPriorityMode === 'priority-list-only'
      ? [...retainedQueue]
      : [...(active ? [active] : []), ...retainedWithoutActive.sort(compareCampaignDeadlines)];
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
      return matchingFavoriteKey(game, input.favoriteGames) !== null &&
        !queuedKeys.has(gameKey(game)) &&
        campaignRejectionReason(game, now) === null &&
        input.campaignDropsByKey?.[gameKey(game)]?.every((drop) => !isRewardFarmableNow(drop, now)) !==
          true &&
        game.rewardSummary?.completion === 'farmable'
        ? [game]
        : [];
    })
    .sort(compareCampaignDeadlines);

  const added: FavoriteCampaignAddition[] = [];
  let plannedQueue = queue;
  for (const game of candidates) {
    if (queuedKeys.has(gameKey(game))) continue;
    const insertion = insertCampaignByDeadline(plannedQueue, game, active ? 1 : 0);
    plannedQueue = insertion.queue;
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

export function setGameFavorite(
  state: AppState,
  game: TwitchGame,
  favorite: boolean,
  now: number,
): { readonly changed: boolean; readonly removedQueueEntries: number } {
  const categoryKey = gameCategoryKey(game);
  const aliases = categoryAliases(state, game);
  const favoriteIndex = state.favoriteGames.findIndex((entry) => preferenceEntryMatches(entry, aliases));
  if (favorite) {
    if (favoriteIndex >= 0) {
      const existing = state.favoriteGames[favoriteIndex];
      state.favoriteGames = [
        ...state.favoriteGames.filter((entry) => !aliases.has(entry.gameId)),
        {
          ...existing,
          gameId: categoryKey,
          lastKnownName: game.name,
          identityKeys: Array.from(new Set([...(existing.identityKeys ?? []), ...aliases])),
        },
      ];
      return { changed: false, removedQueueEntries: 0 };
    }
    state.favoriteGames = [
      ...state.favoriteGames,
      { gameId: categoryKey, lastKnownName: game.name, addedAt: now, identityKeys: Array.from(aliases) },
    ];
    return { changed: true, removedQueueEntries: 0 };
  }

  if (favoriteIndex < 0) {
    return { changed: false, removedQueueEntries: 0 };
  }

  state.favoriteGames = state.favoriteGames.filter(
    (entry) => ![entry.gameId, ...(entry.identityKeys ?? [])].some((key) => aliases.has(key)),
  );
  const before = state.queue.length;
  state.queue = state.queue.filter((queuedGame) => {
    if (gameCategoryKey(queuedGame) !== categoryKey) {
      return true;
    }
    return (
      (state.isRunning &&
        state.selectedGame !== null &&
        gameKey(queuedGame) === gameKey(state.selectedGame)) ||
      state.queueEntryMetadataByKey[gameKey(queuedGame)]?.source !== 'favorite-auto'
    );
  });
  reconcileQueueEntryMetadata(state, now);
  return { changed: true, removedQueueEntries: before - state.queue.length };
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
