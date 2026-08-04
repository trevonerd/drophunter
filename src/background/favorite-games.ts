import {
  favoriteGameIdentityKeys,
  gameCategoryIdentityKeys,
  gameCategoryKey,
  gameKey,
  isFavoriteGame,
} from '../shared/game-selection.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { AppState, QueueEntryMetadata, TwitchGame } from '../types/index.ts';
import { insertFavoriteCampaignByDeadline } from './campaign-priority.ts';

export interface FavoriteCampaignAddition {
  readonly game: TwitchGame;
  readonly position: number;
}

function manualMetadata(addedAt: number): QueueEntryMetadata {
  return { source: 'manual', addedAt, reason: 'user-added' };
}

function favoriteMetadata(addedAt: number): QueueEntryMetadata {
  return { source: 'favorite-auto', addedAt, reason: 'favorite-discovered' };
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

function campaignExpiry(game: TwitchGame): number {
  const parsed = game.endsAt ? Date.parse(game.endsAt) : Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function discoverFavoriteCampaigns(
  state: AppState,
  now: number,
): { readonly added: FavoriteCampaignAddition[] } {
  reconcileQueueEntryMetadata(state, now);
  if (state.campaignPriorityMode !== 'priority-list-only') {
    return { added: [] };
  }

  const favoriteIds = favoriteGameIdentityKeys(state.favoriteGames);
  const queuedKeys = new Set(state.queue.map(gameKey));
  const candidates = state.availableGames
    .filter(
      (game) =>
        isFavoriteGame(game, favoriteIds) &&
        !queuedKeys.has(gameKey(game)) &&
        !isExpiredGame(game) &&
        (game.rewardSummary?.completion === undefined || game.rewardSummary.completion === 'farmable'),
    )
    .sort((left, right) => campaignExpiry(left) - campaignExpiry(right));

  const added: FavoriteCampaignAddition[] = [];
  for (const game of candidates) {
    const insertion = insertFavoriteCampaignByDeadline(state.queue, game);
    state.queue = insertion.queue;
    state.queueEntryMetadataByKey[gameKey(game)] = favoriteMetadata(now);
    queuedKeys.add(gameKey(game));
    added.push({ game, position: insertion.position });
  }
  return { added };
}
