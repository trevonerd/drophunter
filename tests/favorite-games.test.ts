import { describe, expect, test } from 'bun:test';
import {
  discoverFavoriteCampaigns,
  reconcileQueueEntryMetadata,
  setGameFavorite,
} from '../src/background/favorite-games.ts';
import { favoriteGameIdentityKeys, gameKey, isFavoriteGame } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchGame } from '../src/types/index.ts';
import { game } from './support/favorite-game-fixture.ts';
import './cases/favorite-game-visibility.ts';

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

  test('favorite discovery queues every farmable campaign for a Twitch category by deadline', () => {
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

    // When: favorite automation queues every campaign in the category.
    discoverFavoriteCampaigns(state, 200);

    // Then: campaign identity is retained and deterministic display order breaks the tie.
    expect(state.queue.map((entry) => entry.campaignId)).toEqual(['campaign-a', 'campaign-z']);
  });

  test('favorite discovery removes completed campaigns while retaining separate active campaigns', () => {
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
      queue: ['campaign-next', 'campaign-manual', 'campaign-auto'],
      metadata: {
        [gameKey(redundantAuto)]: { source: 'favorite-auto', addedAt: 12, reason: 'favorite-discovered' },
        [gameKey(nextAuto)]: { source: 'favorite-auto', addedAt: 200, reason: 'favorite-discovered' },
        [gameKey(manual)]: { source: 'manual', addedAt: 13, reason: 'user-added' },
      },
      added: ['campaign-next'],
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

    expect(result.removedQueueEntries).toBe(1);
    expect(state.favoriteGames).toEqual([]);
    expect(state.queue).toEqual([active, manual]);
    expect(state.selectedGame).toEqual(active);
    expect(state.isRunning).toBe(true);
    expect(state.queueEntryMetadataByKey).toEqual({
      [gameKey(active)]: { source: 'favorite-auto', addedAt: 10, reason: 'favorite-discovered' },
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

  test('retired priority modes no longer block favorite discovery', () => {
    const state = createInitialState();
    const favorite = game('campaign-a');
    state.availableGames = [favorite];
    state.favoriteGames = [{ gameId: favorite.id, lastKnownName: favorite.name, addedAt: 10 }];
    state.campaignPriorityMode = 'ending-soonest';

    expect(discoverFavoriteCampaigns(state, 20).added.map((entry) => entry.game)).toEqual([favorite]);
    expect(state.queue).toEqual([favorite]);
  });

  test('discovers favorite campaigns in the retired priority modes and places them ahead of manual entries by deadline', () => {
    // Given: two favorite campaigns discovered after a manually added campaign.
    const state = createInitialState();
    const manual = game('campaign-manual', 'manual', '2030-08-10T14:00:00.000Z');
    const laterFavorite = game('campaign-later', 'later', '2030-08-05T14:00:00.000Z');
    const earlierFavorite = game('campaign-earlier', 'earlier', '2030-08-03T14:00:00.000Z');
    state.availableGames = [laterFavorite, earlierFavorite, manual];
    state.queue = [manual];
    state.queueEntryMetadataByKey = {
      [gameKey(manual)]: { source: 'manual', addedAt: 10, reason: 'user-added' },
    };
    state.favoriteGames = [
      { gameId: laterFavorite.id, lastKnownName: laterFavorite.name, addedAt: 1 },
      { gameId: earlierFavorite.id, lastKnownName: earlierFavorite.name, addedAt: 2 },
    ];
    state.campaignPriorityMode = 'lowest-availability';

    // When: favorite discovery reconciles the queue.
    const discovery = discoverFavoriteCampaigns(state, 20);

    // Then: automatic favorites are deadline ordered and manual ordering stays behind them.
    expect({
      queue: state.queue.map((entry) => entry.campaignId),
      added: discovery.added.map((entry) => entry.game.campaignId),
    }).toEqual({
      queue: ['campaign-earlier', 'campaign-later', 'campaign-manual'],
      added: ['campaign-earlier', 'campaign-later'],
    });
  });

  test('keeps the active campaign at the head until transition policy approves preemption', () => {
    const state = createInitialState();
    const active = { ...game('campaign-active', 'active'), endsAt: null };
    const laterFavorite = game('campaign-later', 'later', '2030-08-05T14:00:00.000Z');
    state.availableGames = [active, laterFavorite];
    state.favoriteGames = [
      { gameId: active.id, lastKnownName: active.name, addedAt: 1 },
      { gameId: laterFavorite.id, lastKnownName: laterFavorite.name, addedAt: 2 },
    ];
    state.queue = [active];
    state.queueEntryMetadataByKey = {
      [gameKey(active)]: { source: 'favorite-auto', addedAt: 1, reason: 'favorite-discovered' },
    };
    state.selectedGame = active;
    state.isRunning = true;

    discoverFavoriteCampaigns(state, 20);

    expect(state.queue.map((entry) => entry.campaignId)).toEqual(['campaign-active', 'campaign-later']);
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
