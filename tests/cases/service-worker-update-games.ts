import { expect, test } from 'bun:test';
import type { TwitchGame } from '../../src/types/index.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { dispatchMessage, getAppStateFromStorage } from '../helpers/service-worker-harness.ts';

export function registerUpdateGamesCases() {
  test('UPDATE_GAMES preserves trusted allDropsCompleted=true when no matching drops exist', async () => {
    const gameWithCompletedMarked = { ...demoGame, allDropsCompleted: true };
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCompletedMarked],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames[0].allDropsCompleted).toBe(true);
  });

  test('UPDATE_GAMES leaves allDropsCompleted=false unchanged when no drops match', async () => {
    const gameWithIncompleteMarked = { ...demoGame, allDropsCompleted: false };
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithIncompleteMarked],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames[0].allDropsCompleted).toBe(false);
  });

  test('UPDATE_GAMES correctly annotates multiple games from UPDATE_GAMES message', async () => {
    const game2: TwitchGame = {
      id: 'game-2',
      name: 'Another Game',
      imageUrl: 'https://example.com/another.png',
      allDropsCompleted: true,
    };

    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [demoGame, game2],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames).toHaveLength(2);
    expect(state.availableGames.some((g) => g.id === 'game-1')).toBe(true);
    expect(state.availableGames.some((g) => g.id === 'game-2')).toBe(true);
    expect(state.availableGames.find((g) => g.id === 'game-2')?.allDropsCompleted).toBe(true);
  });

  test('UPDATE_GAMES updates lastSuccessfulRefreshAt when games are provided', async () => {
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [demoGame],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(typeof state.lastSuccessfulRefreshAt).toBe('number');
    expect(state.lastSuccessfulRefreshAt).toBeGreaterThan(0);
  });
}
