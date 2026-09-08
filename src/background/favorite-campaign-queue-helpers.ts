import { gameCategoryIdentityKeys, gameKey } from '../shared/game-selection.ts';
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

export function favoriteDeadline(game: TwitchGame): number {
  const parsed = game.endsAt ? Date.parse(game.endsAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function reconcileQueueEntryMetadata(state: AppState, now: number): void {
  state.queueEntryMetadataByKey = Object.fromEntries(
    state.queue.map((game) => {
      const key = gameKey(game);
      return [key, state.queueEntryMetadataByKey[key] ?? manualQueueMetadata(now)];
    }),
  );
}
