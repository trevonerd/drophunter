import { describe, expect, test } from 'bun:test';
import { removeGameFromQueue } from '../../src/background/queue-operations.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue02Part01() {
  describe('removeGameFromQueue', () => {
    test('removes matching game from queue', () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1' });
      const game2 = createGame({ id: 'game-2' });
      const game3 = createGame({ id: 'game-3' });
      state.appState.queue = [game1, game2, game3];
      removeGameFromQueue(state, game2);
      expect(state.appState.queue).toHaveLength(2);
      expect(state.appState.queue.map((g) => g.id)).toEqual(['game-1', 'game-3']);
    });

    test('removes all matching games from queue', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'duplicate' });
      state.appState.queue = [game, game, game];
      removeGameFromQueue(state, game);
      expect(state.appState.queue).toHaveLength(0);
    });

    test('does nothing if game not in queue', () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1' });
      const game2 = createGame({ id: 'game-2' });
      state.appState.queue = [game1];
      removeGameFromQueue(state, game2);
      expect(state.appState.queue).toHaveLength(1);
    });
  });
}
