import {
  compareGamesForDisplayOrder,
  gameCategoryIdentityKeys,
  gameCategoryKey,
  gameKey,
} from '../shared/game-selection.ts';
import type {
  AppState,
  CampaignPriorityMode,
  FavoriteGame,
  QueueEntryMetadata,
  TwitchGame,
} from '../types/index.ts';
import { insertFavoriteCampaignByDeadline } from './campaign-priority.ts';

export interface FavoriteCampaignAddition {
  readonly game: TwitchGame;
  readonly position: number;
}

export interface FavoriteCampaignQueuePlanInput {
  readonly availableGames: readonly TwitchGame[];
  readonly favoriteGames: readonly FavoriteGame[];
  readonly queue: readonly TwitchGame[];
  readonly queueEntryMetadataByKey: Readonly<Record<string, QueueEntryMetadata>>;
  readonly campaignPriorityMode: CampaignPriorityMode;
}

export interface FavoriteCampaignQueuePlan {
  readonly queue: readonly TwitchGame[];
  readonly queueEntryMetadataByKey: Readonly<Record<string, QueueEntryMetadata>>;
  readonly added: readonly FavoriteCampaignAddition[];
}

function manualMetadata(addedAt: number): QueueEntryMetadata {
  return { source: 'manual', addedAt, reason: 'user-added' };
}

function favoriteMetadata(addedAt: number): QueueEntryMetadata {
  return { source: 'favorite-auto', addedAt, reason: 'favorite-discovered' };
}

function isExpiredAt(game: TwitchGame, now: number): boolean {
  if (typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)) {
    return game.expiresInMs <= 0;
  }
  if (!game.endsAt) {
    return false;
  }
  const endsAt = Date.parse(game.endsAt);
  return Number.isFinite(endsAt) && endsAt <= now;
}

function planQueueMetadata(
  queue: readonly TwitchGame[],
  metadata: Readonly<Record<string, QueueEntryMetadata>>,
  now: number,
): Record<string, QueueEntryMetadata> {
  return Object.fromEntries(
    queue.map((game) => [gameKey(game), metadata[gameKey(game)] ?? manualMetadata(now)]),
  );
}

function matchingFavoriteKey(game: TwitchGame, favorites: readonly FavoriteGame[]): string | null {
  const categoryKeys = new Set(gameCategoryIdentityKeys(game));
  const favorite = favorites.find((entry) =>
    [entry.gameId, ...(entry.identityKeys ?? [])].some((key) => categoryKeys.has(key)),
  );
  return favorite?.gameId ?? null;
}

export function planFavoriteCampaignQueue(
  input: FavoriteCampaignQueuePlanInput,
  now: number,
): FavoriteCampaignQueuePlan {
  if (input.campaignPriorityMode !== 'priority-list-only') {
    return {
      queue: [...input.queue],
      queueEntryMetadataByKey: { ...input.queueEntryMetadataByKey },
      added: [],
    };
  }

  const originalQueueKeys = new Set(input.queue.map(gameKey));
  const originalMetadata = planQueueMetadata(input.queue, input.queueEntryMetadataByKey, now);
  const queue = input.queue.filter((game) => originalMetadata[gameKey(game)]?.source !== 'favorite-auto');
  const queueEntryMetadataByKey = planQueueMetadata(queue, originalMetadata, now);
  const queuedKeys = new Set(queue.map(gameKey));
  const representedFavorites = new Set(
    queue.flatMap((game) => {
      const favoriteKey = matchingFavoriteKey(game, input.favoriteGames);
      return favoriteKey ? [favoriteKey] : [];
    }),
  );
  const candidates = input.availableGames
    .flatMap((game) => {
      const favoriteKey = matchingFavoriteKey(game, input.favoriteGames);
      return favoriteKey &&
        !queuedKeys.has(gameKey(game)) &&
        !isExpiredAt(game, now) &&
        game.rewardSummary?.completion === 'farmable'
        ? [{ game, favoriteKey }]
        : [];
    })
    .sort((left, right) => compareGamesForDisplayOrder(left.game, right.game));

  const added: FavoriteCampaignAddition[] = [];
  for (const { game, favoriteKey } of candidates) {
    if (representedFavorites.has(favoriteKey)) continue;
    const insertion = insertFavoriteCampaignByDeadline(queue, game);
    queue.splice(0, queue.length, ...insertion.queue);
    const key = gameKey(game);
    queueEntryMetadataByKey[key] = originalMetadata[key] ?? favoriteMetadata(now);
    queuedKeys.add(key);
    representedFavorites.add(favoriteKey);
    if (!originalQueueKeys.has(key)) {
      added.push({ game, position: insertion.position });
    }
  }

  return { queue, queueEntryMetadataByKey, added };
}

export function reconcileQueueEntryMetadata(state: AppState, now: number): void {
  state.queueEntryMetadataByKey = Object.fromEntries(
    state.queue.map((game) => {
      const key = gameKey(game);
      return [key, state.queueEntryMetadataByKey[key] ?? manualMetadata(now)];
    }),
  );
}

export function setGameFavorite(
  state: AppState,
  game: TwitchGame,
  favorite: boolean,
  now: number,
): { readonly changed: boolean; readonly removedQueueEntries: number } {
  const categoryKey = gameCategoryKey(game);
  const primaryAliases = new Set(gameCategoryIdentityKeys(game));
  const sameCategoryGames = state.availableGames.filter((candidate) =>
    gameCategoryIdentityKeys(candidate).some((key) => primaryAliases.has(key)),
  );
  const aliases = new Set([...primaryAliases, ...sameCategoryGames.flatMap(gameCategoryIdentityKeys)]);
  const favoriteIndex = state.favoriteGames.findIndex((entry) =>
    [entry.gameId, ...(entry.identityKeys ?? [])].some((key) => aliases.has(key)),
  );
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
    return state.queueEntryMetadataByKey[gameKey(queuedGame)]?.source !== 'favorite-auto';
  });
  reconcileQueueEntryMetadata(state, now);
  return { changed: true, removedQueueEntries: before - state.queue.length };
}

export function discoverFavoriteCampaigns(
  state: AppState,
  now: number,
): { readonly added: FavoriteCampaignAddition[] } {
  reconcileQueueEntryMetadata(state, now);
  if (state.campaignPriorityMode !== 'priority-list-only') {
    return { added: [] };
  }

  const plan = planFavoriteCampaignQueue(state, now);
  state.queue = [...plan.queue];
  state.queueEntryMetadataByKey = { ...plan.queueEntryMetadataByKey };
  return { added: [...plan.added] };
}
