import { describe, expect, test } from 'bun:test';
import { reorderQueue } from '../../src/background/queue-operations.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue06Part01() {
  describe('reorderQueue', () => {
    test('moves a queue item forward', () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      const game2 = createGame({ id: 'game-2', campaignId: 'campaign-2' });
      const game3 = createGame({ id: 'game-3', campaignId: 'campaign-3' });
      state.appState.queue = [game1, game2, game3];

      expect(reorderQueue(state, 2, 0)).toBe(true);
      expect(state.appState.queue.map((game) => game.campaignId)).toEqual([
        'campaign-3',
        'campaign-1',
        'campaign-2',
      ]);
    });

    test('moves a queue item backward', () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      const game2 = createGame({ id: 'game-2', campaignId: 'campaign-2' });
      state.appState.queue = [game1, game2];

      expect(reorderQueue(state, 0, 1)).toBe(true);
      expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['campaign-2', 'campaign-1']);
    });

    test('rejects invalid indices and no-op reorders', () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1' });
      const game2 = createGame({ id: 'game-2' });
      state.appState.queue = [game1, game2];

      expect(reorderQueue(state, -1, 0)).toBe(false);
      expect(reorderQueue(state, 0, 2)).toBe(false);
      expect(reorderQueue(state, 0, 0)).toBe(false);
      expect(state.appState.queue.map((game) => game.id)).toEqual(['game-1', 'game-2']);
    });
  });
}
