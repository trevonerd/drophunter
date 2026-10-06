import { dropMatchesGame, gameIdentity, gameKey, isSameGameIdentity } from '../shared/game-selection';
import { isRewardWatchable } from '../shared/reward-semantics.ts';
import type { AppState, TwitchGame } from '../types';
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
  state?: Pick<AppState, 'campaignDropsByKey' | 'allDrops'>,
): TwitchGame | null {
  const canStart = (game: TwitchGame) => {
    const drops =
      state?.campaignDropsByKey[gameKey(game)] ??
      state?.allDrops.filter((drop) => dropMatchesGame(drop, game));
    return isCampaignFarmable(game) && (!drops?.length || drops.some(isRewardWatchable));
  };
  if (queueGames.length === 0) {
    return selectedGame && canStart(selectedGame) ? selectedGame : null;
  }

  return queueGames.find(canStart) ?? null;
}
