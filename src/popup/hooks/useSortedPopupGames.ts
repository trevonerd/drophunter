import { useMemo } from 'react';
import { sortPendingDrops } from '../../shared/drop-order';
import { dropMatchesGame, gameKey, getGameDisplayLabel } from '../../shared/game-selection';
import { isExpiredGame } from '../../shared/utils';
import type { AppState, TwitchGame } from '../../types';

function expiry(game: TwitchGame): number {
  const parsed = game.endsAt ? Date.parse(game.endsAt) : Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function useSortedPopupGames(state: AppState) {
  const pendingDrops = useMemo(() => sortPendingDrops(state.pendingDrops), [state.pendingDrops]);
  const sortedGames = useMemo(() => {
    const active = state.availableGames.filter((game) => !isExpiredGame(game));
    const campaignCatalogDrops = Object.values(state.campaignDropsByKey).flat();
    const priorityDrops = campaignCatalogDrops.length > 0 ? campaignCatalogDrops : state.allDrops;
    const queueIndex = new Map(state.queue.map((game, index) => [gameKey(game), index]));
    const started = (game: TwitchGame) =>
      priorityDrops.some((drop) => dropMatchesGame(drop, game) && drop.progress > 0 && !drop.claimed);
    const availability = (game: TwitchGame) =>
      state.campaignAvailabilityByKey[gameKey(game)]?.eligibleStreamerCount ?? Number.POSITIVE_INFINITY;

    return [...active].sort((left, right) => {
      if (state.campaignPriorityMode === 'priority-list-only') {
        const leftIndex = queueIndex.get(gameKey(left)) ?? Number.POSITIVE_INFINITY;
        const rightIndex = queueIndex.get(gameKey(right)) ?? Number.POSITIVE_INFINITY;
        return leftIndex - rightIndex || getGameDisplayLabel(left).localeCompare(getGameDisplayLabel(right));
      }
      if (state.campaignPriorityMode === 'lowest-availability') {
        return (
          availability(left) - availability(right) ||
          expiry(left) - expiry(right) ||
          Number(started(right)) - Number(started(left)) ||
          (left.campaignId ?? left.id).localeCompare(right.campaignId ?? right.id)
        );
      }
      return (
        expiry(left) - expiry(right) ||
        Number(started(right)) - Number(started(left)) ||
        availability(left) - availability(right) ||
        (left.campaignId ?? left.id).localeCompare(right.campaignId ?? right.id)
      );
    });
  }, [
    state.allDrops,
    state.availableGames,
    state.campaignAvailabilityByKey,
    state.campaignDropsByKey,
    state.campaignPriorityMode,
    state.queue,
  ]);

  const queueGames = useMemo(() => {
    const fallbackByCampaignId = new Map(
      sortedGames.filter((game) => game.campaignId).map((game) => [game.campaignId, game]),
    );
    const fallbackById = new Map(
      sortedGames.filter((game) => !game.campaignId).map((game) => [game.id, game]),
    );
    return state.queue.map((game) =>
      game.campaignId
        ? (fallbackByCampaignId.get(game.campaignId) ?? game)
        : (fallbackById.get(game.id) ?? game),
    );
  }, [state.queue, sortedGames]);

  return { pendingDrops, completedDrops: state.completedDrops, sortedGames, queueGames };
}
