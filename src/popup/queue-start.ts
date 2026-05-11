import type { TwitchGame } from '../types';

function isSameQueuedGame(left: TwitchGame, right: TwitchGame): boolean {
  return left.id === right.id && left.campaignId === right.campaignId;
}

export function getGameToStartFromQueue(
  selectedGame: TwitchGame | null,
  queueGames: TwitchGame[],
): TwitchGame | null {
  if (queueGames.length === 0) {
    return selectedGame;
  }

  if (!selectedGame) {
    return queueGames[0] ?? null;
  }

  const selectedIsQueued = queueGames.some((game) => isSameQueuedGame(game, selectedGame));
  return selectedIsQueued ? (queueGames[0] ?? null) : selectedGame;
}
