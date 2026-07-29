import { gameIdentity, isSameGameIdentity } from '../shared/game-selection';
import type { TwitchGame } from '../types';
import { isCampaignFarmable } from './format';

export function queueGameIdentity(game: TwitchGame): string {
  return gameIdentity(game);
}

export function isSameQueuedGame(left: TwitchGame, right: TwitchGame): boolean {
  return isSameGameIdentity(left, right);
}

export function getGameToStartFromQueue(
  selectedGame: TwitchGame | null,
  queueGames: TwitchGame[],
): TwitchGame | null {
  if (queueGames.length === 0) {
    return selectedGame;
  }

  const firstFarmableQueueGame = queueGames.find(isCampaignFarmable) ?? null;

  if (!selectedGame) {
    return firstFarmableQueueGame;
  }

  const selectedIsQueued = queueGames.some((game) => isSameQueuedGame(game, selectedGame));
  return selectedIsQueued
    ? firstFarmableQueueGame
    : isCampaignFarmable(selectedGame)
      ? selectedGame
      : firstFarmableQueueGame;
}
