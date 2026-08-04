import { describe, expect, test } from 'bun:test';
import {
  discoverFavoriteCampaigns,
  reconcileQueueEntryMetadata,
  setGameFavorite,
} from '../src/background/favorite-games.ts';
import { favoriteGameIdentityKeys, gameKey, isFavoriteGame } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchGame } from '../src/types/index.ts';

function game(campaignId: string, gameId = 'valorant', endsAt = '2030-08-03T14:00:00.000Z'): TwitchGame {
  return {
    id: gameId,
    name: gameId === 'valorant' ? 'Valorant' : 'Other',
    campaignId,
    campaignName: campaignId,
    endsAt,
    imageUrl: '',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

describe('favorite games', () => {
  test('favorites belong to the Twitch category and keep separate campaigns', () => {
    const state = createInitialState();
    const first = game('campaign-a');
    const second = game('campaign-b', 'valorant', '2030-08-03T13:00:00.000Z');
    state.availableGames = [first, second];
    state.campaignPriorityMode = 'priority-list-only';

    expect(setGameFavorite(state, first, true, 100).changed).toBe(true);
    const discovery = discoverFavoriteCampaigns(state, 200);

    expect(state.favoriteGames).toEqual([
      {
        gameId: 'valorant',
        lastKnownName: 'Valorant',
        addedAt: 100,
        identityKeys: ['valorant'],
      },
    ]);
    expect(state.queue.map((entry) => entry.campaignId)).toEqual(['campaign-b', 'campaign-a']);
    expect(discovery.added.map((entry) => entry.game.campaignId)).toEqual(['campaign-b', 'campaign-a']);
    expect(state.queueEntryMetadataByKey[gameKey(first)]).toEqual({
      source: 'favorite-auto',
      addedAt: 200,
      reason: 'favorite-discovered',
    });
  });

  test('unstar removes only favorite-auto queue entries and does not stop active farming', () => {
    const state = createInitialState();
    const active = game('campaign-active');
    const automatic = game('campaign-auto');
    const manual = game('campaign-manual');
    state.favoriteGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 10 }];
    state.queue = [active, automatic, manual];
    state.selectedGame = active;
    state.isRunning = true;
    state.queueEntryMetadataByKey = {
      [gameKey(active)]: { source: 'favorite-auto', addedAt: 10, reason: 'favorite-discovered' },
      [gameKey(automatic)]: { source: 'favorite-auto', addedAt: 11, reason: 'favorite-discovered' },
      [gameKey(manual)]: { source: 'manual', addedAt: 12, reason: 'user-added' },
    };

    const result = setGameFavorite(state, active, false, 20);

    expect(result.removedQueueEntries).toBe(2);
    expect(state.favoriteGames).toEqual([]);
    expect(state.queue).toEqual([manual]);
    expect(state.selectedGame).toEqual(active);
    expect(state.isRunning).toBe(true);
    expect(state.queueEntryMetadataByKey).toEqual({
      [gameKey(manual)]: { source: 'manual', addedAt: 12, reason: 'user-added' },
    });
  });

  test('reconciliation seeds legacy queue entries as manual and prunes orphan metadata', () => {
    const state = createInitialState();
    const queued = game('queued');
    state.queue = [queued];
    state.queueEntryMetadataByKey = {
      orphan: { source: 'favorite-auto', addedAt: 1, reason: 'favorite-discovered' },
    };

    reconcileQueueEntryMetadata(state, 50);

    expect(state.queueEntryMetadataByKey).toEqual({
      [gameKey(queued)]: { source: 'manual', addedAt: 50, reason: 'user-added' },
    });
  });

  test('automatic priority modes do not mutate the visible manual queue', () => {
    const state = createInitialState();
    const favorite = game('campaign-a');
    state.availableGames = [favorite];
    state.favoriteGames = [{ gameId: favorite.id, lastKnownName: favorite.name, addedAt: 10 }];
    state.campaignPriorityMode = 'ending-soonest';

    expect(discoverFavoriteCampaigns(state, 20).added).toEqual([]);
    expect(state.queue).toEqual([]);
  });

  test('favorite identity survives category id and slug drift without duplicates', () => {
    const state = createInitialState();
    const slugSnapshot = {
      ...game('campaign-a', 'campaign-game-id'),
      name: 'Valorant',
      categorySlug: 'valorant',
    };
    const idSnapshot = { ...slugSnapshot, categoryId: '509658' };
    state.availableGames = [slugSnapshot];

    expect(setGameFavorite(state, slugSnapshot, true, 100).changed).toBe(true);
    expect(isFavoriteGame(idSnapshot, favoriteGameIdentityKeys(state.favoriteGames))).toBe(true);

    state.availableGames = [idSnapshot];
    expect(setGameFavorite(state, idSnapshot, true, 200).changed).toBe(false);
    expect(state.favoriteGames).toHaveLength(1);
  });
});
