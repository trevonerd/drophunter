import { describe, expect, test } from 'bun:test';
import { setGamePreference } from '../../src/background/favorite-games.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import { game } from '../support/favorite-game-fixture.ts';

describe('favorite games', () => {
  test('hiding a favorite makes it hidden while retaining running and queued work', () => {
    // Given: a running favorite with automatic campaigns already queued.
    const state = createInitialState();
    const active = game('campaign-active');
    const queued = game('campaign-queued');
    state.availableGames = [active, queued];
    state.favoriteGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 10 }];
    state.queue = [active, queued];
    state.selectedGame = active;
    state.isRunning = true;
    state.queueEntryMetadataByKey = {
      [gameKey(active)]: { source: 'favorite-auto', addedAt: 11, reason: 'favorite-discovered' },
      [gameKey(queued)]: { source: 'favorite-auto', addedAt: 12, reason: 'favorite-discovered' },
    };

    // When: the user hides the game category.
    const result = setGamePreference(state, active, 'hidden', 20);

    // Then: the preference is exclusive and existing work becomes user-retained.
    expect(result).toEqual({
      changed: true,
      preference: 'hidden',
      removedQueueEntries: 0,
      retainedQueueEntries: 2,
    });
    expect(state.favoriteGames).toEqual([]);
    expect(state.hiddenGames).toEqual([
      {
        gameId: 'valorant',
        lastKnownName: 'Valorant',
        hiddenAt: 20,
        identityKeys: ['valorant'],
      },
    ]);
    expect(state.queue).toEqual([active, queued]);
    expect(state.selectedGame).toEqual(active);
    expect(state.isRunning).toBe(true);
    expect(state.queueEntryMetadataByKey).toEqual({
      [gameKey(active)]: { source: 'manual', addedAt: 11, reason: 'retained-after-hide' },
      [gameKey(queued)]: { source: 'manual', addedAt: 12, reason: 'retained-after-hide' },
    });
  });

  test('favoriting a hidden game restores it directly as a favorite', () => {
    // Given: a hidden game category.
    const state = createInitialState();
    const hidden = game('campaign-hidden');
    state.availableGames = [hidden];
    state.hiddenGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', hiddenAt: 10 }];

    // When: the user stars the hidden game.
    const result = setGamePreference(state, hidden, 'favorite', 20);

    // Then: hidden and favorite cannot overlap.
    expect(result.preference).toBe('favorite');
    expect(state.hiddenGames).toEqual([]);
    expect(state.favoriteGames).toEqual([
      {
        gameId: 'valorant',
        lastKnownName: 'Valorant',
        addedAt: 20,
        identityKeys: ['valorant'],
      },
    ]);
  });

  test('restoring a hidden game returns it to the normal state', () => {
    // Given: a hidden game category.
    const state = createInitialState();
    const hidden = game('campaign-hidden');
    state.availableGames = [hidden];
    state.hiddenGames = [{ gameId: 'valorant', lastKnownName: 'Valorant', hiddenAt: 10 }];

    // When: the user restores the game without starring it.
    const result = setGamePreference(state, hidden, 'normal', 20);

    // Then: no category preference remains.
    expect(result.preference).toBe('normal');
    expect(state.hiddenGames).toEqual([]);
    expect(state.favoriteGames).toEqual([]);
  });
});
