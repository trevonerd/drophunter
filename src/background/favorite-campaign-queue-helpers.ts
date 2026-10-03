import { gameCategoryIdentityKeys, gameCategoryKey, gameKey } from '../shared/game-selection.ts';
import type {
  AppState,
  FavoriteGame,
  GamePreference,
  QueueEntryMetadata,
  TwitchGame,
} from '../types/index.ts';

export interface SetGamePreferenceResult {
  readonly changed: boolean;
  readonly preference: GamePreference;
  readonly removedQueueEntries: number;
  readonly retainedQueueEntries: number;
}

export function categoryAliases(state: AppState, game: TwitchGame): ReadonlySet<string> {
  const primaryAliases = new Set(gameCategoryIdentityKeys(game));
  const sameCategoryGames = state.availableGames.filter((candidate) =>
    gameCategoryIdentityKeys(candidate).some((key) => primaryAliases.has(key)),
  );
  return new Set([...primaryAliases, ...sameCategoryGames.flatMap(gameCategoryIdentityKeys)]);
}

export function preferenceEntryMatches(
  entry: { readonly gameId: string; readonly identityKeys?: readonly string[] },
  aliases: ReadonlySet<string>,
): boolean {
  return [entry.gameId, ...(entry.identityKeys ?? [])].some((key) => aliases.has(key));
}

export function manualQueueMetadata(addedAt: number): QueueEntryMetadata {
  return { source: 'manual', addedAt, reason: 'user-added' };
}

export function automaticFavoriteQueueMetadata(addedAt: number): QueueEntryMetadata {
  return { source: 'favorite-auto', addedAt, reason: 'favorite-discovered' };
}

export function planQueueMetadata(
  queue: readonly TwitchGame[],
  metadata: Readonly<Record<string, QueueEntryMetadata>>,
  now: number,
): Record<string, QueueEntryMetadata> {
  return Object.fromEntries(
    queue.map((game) => [gameKey(game), metadata[gameKey(game)] ?? manualQueueMetadata(now)]),
  );
}

export function matchingFavoriteKey(game: TwitchGame, favorites: readonly FavoriteGame[]): string | null {
  const categoryKeys = new Set(gameCategoryIdentityKeys(game));
  const favorite = favorites.find((entry) =>
    [entry.gameId, ...(entry.identityKeys ?? [])].some((key) => categoryKeys.has(key)),
  );
  return favorite?.gameId ?? null;
}

export function reconcileQueueEntryMetadata(state: AppState, now: number): void {
  state.queueEntryMetadataByKey = Object.fromEntries(
    state.queue.map((game) => {
      const key = gameKey(game);
      return [key, state.queueEntryMetadataByKey[key] ?? manualQueueMetadata(now)];
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
