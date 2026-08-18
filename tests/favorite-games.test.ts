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
  test('favorite discovery waits for an authoritative reward classification', () => {
    // Given: a favorite campaign whose reward catalog is still loading and has no summary.
    const state = createInitialState();
    const loading: TwitchGame = {
      id: 'valorant',
      name: 'Valorant',
      campaignId: 'campaign-loading',
      campaignName: 'Campaign loading',
      endsAt: '2030-08-03T12:00:00.000Z',
      imageUrl: '',
    };
    state.availableGames = [loading];
    state.favoriteGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 100 }];
    state.campaignPriorityMode = 'priority-list-only';

    // When: favorite automation evaluates the incomplete snapshot.
    const discovery = discoverFavoriteCampaigns(state, 200);

    // Then: it queues nothing until Twitch supplies authoritative reward evidence.
    expect({ queue: state.queue, added: discovery.added }).toEqual({ queue: [], added: [] });
  });

  test('favorite discovery queues only the earliest farmable campaign for a Twitch category', () => {
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
    expect(state.queue.map((entry) => entry.campaignId)).toEqual(['campaign-b']);
    expect(discovery.added.map((entry) => entry.game.campaignId)).toEqual(['campaign-b']);
    expect(state.queueEntryMetadataByKey[gameKey(second)]).toEqual({
      source: 'favorite-auto',
      addedAt: 200,
      reason: 'favorite-discovered',
    });
  });

  test('equal-expiry favorite campaigns follow the normal display order', () => {
    // Given: two farmable campaigns with the same expiry in reverse display order.
    const state = createInitialState();
    const laterInList = game('campaign-z');
    const firstInList = game('campaign-a');
    state.availableGames = [laterInList, firstInList];
    state.favoriteGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 100 }];
    state.campaignPriorityMode = 'priority-list-only';

    // When: favorite automation chooses one campaign for the category.
    discoverFavoriteCampaigns(state, 200);

    // Then: the first campaign in deterministic display order wins the tie.
    expect(state.queue.map((entry) => entry.campaignId)).toEqual(['campaign-a']);
  });

  test('favorite discovery removes automatic siblings when a manual campaign already represents the game', () => {
    const state = createInitialState();
    const completedAuto = {
      ...game('campaign-completed'),
      rewardSummary: { completion: 'all-acquired' as const, remainderReasons: [] },
    };
    const redundantAuto = game('campaign-auto', 'valorant', '2030-08-04T14:00:00.000Z');
    const nextAuto = game('campaign-next', 'valorant', '2030-08-02T14:00:00.000Z');
    const manual = game('campaign-manual');
    state.availableGames = [completedAuto, redundantAuto, nextAuto, manual];
    state.favoriteGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 10 }];
    state.campaignPriorityMode = 'priority-list-only';
    state.queue = [completedAuto, redundantAuto, manual];
    state.queueEntryMetadataByKey = {
      [gameKey(completedAuto)]: { source: 'favorite-auto', addedAt: 11, reason: 'favorite-discovered' },
      [gameKey(redundantAuto)]: { source: 'favorite-auto', addedAt: 12, reason: 'favorite-discovered' },
      [gameKey(manual)]: { source: 'manual', addedAt: 13, reason: 'user-added' },
    };

    const discovery = discoverFavoriteCampaigns(state, 200);

    expect({
      queue: state.queue.map((entry) => entry.campaignId),
      metadata: state.queueEntryMetadataByKey,
      added: discovery.added.map((entry) => entry.game.campaignId),
    }).toEqual({
      queue: ['campaign-manual'],
      metadata: {
        [gameKey(manual)]: { source: 'manual', addedAt: 13, reason: 'user-added' },
      },
      added: [],
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
