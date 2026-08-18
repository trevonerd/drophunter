import { describe, expect, test } from 'bun:test';
import { pushGameToQueue } from '../../src/background/queue-operations.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue05Part01() {
  describe('pushGameToQueue', () => {
    test('adds game to end of queue', () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1' });
      const game2 = createGame({ id: 'game-2' });
      state.appState.queue = [game1];
      pushGameToQueue(state, game2);
      expect(state.appState.queue).toHaveLength(2);
      expect(state.appState.queue[1].id).toBe('game-2');
    });

    test('does not add duplicate game to queue', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1' });
      state.appState.queue = [game];
      pushGameToQueue(state, createGame({ id: 'game-1' }));
      expect(state.appState.queue).toHaveLength(1);
    });

    test('adds game to empty queue', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1' });
      pushGameToQueue(state, game);
      expect(state.appState.queue).toHaveLength(1);
      expect(state.appState.queue[0].id).toBe('game-1');
    });
  });
}
