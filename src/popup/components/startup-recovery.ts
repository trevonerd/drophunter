import {
  favoriteGameIdentityKeys,
  hiddenGameIdentityKeys,
  isFavoriteGame,
  isHiddenGame,
} from '../../shared/game-selection';
import type { AppState } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import { isCampaignFarmable } from '../format';

export function startupRecovery(state: AppState, status: CampaignSyncStatus) {
  const isBlocking =
    !state.isRunning &&
    !state.isPaused &&
    (status === 'syncing' || status === 'pending-validation' || status === 'waiting' || status === 'failed');
  const favorites = favoriteGameIdentityKeys(state.favoriteGames ?? []);
  const hidden = hiddenGameIdentityKeys(state.hiddenGames ?? []);
  const hasAutomaticFavorite =
    state.autoStartFavoriteGames &&
    [...state.queue, ...state.availableGames].some(
      (game) => isFavoriteGame(game, favorites) && !isHiddenGame(game, hidden) && isCampaignFarmable(game),
    );
  const automaticStartPending =
    isBlocking &&
    !state.lastStopReason &&
    (state.manualWatchState ?? 'inactive') === 'inactive' &&
    ((state.manualQueueAuthorized && state.queue.length > 0) || hasAutomaticFavorite);
  return { isBlocking, automaticStartPending };
}
