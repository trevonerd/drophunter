import { describe, expect, test } from 'bun:test';
import { handleReorderQueue } from '../../src/background/drops-tick.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue07Part01() {
  describe('handleReorderQueue', () => {
    test('switches to priority-list-only atomically on the first direct reorder', async () => {
      const state = createMinimalState();
      state.appState.campaignPriorityMode = 'ending-soonest';
      const first = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      const second = createGame({ id: 'game-2', campaignId: 'campaign-2' });
      state.appState.queue = [first, second];
      let saved = 0;

      const result = await handleReorderQueue(
        state,
        { fromIndex: 0, toIndex: 1 },
        {
          onTrackActivity: async () => undefined,
          onSaveState: async () => {
            saved += 1;
          },
        },
      );

      expect(result.success).toBe(true);
      expect(result.reordered).toBe(true);
      expect(state.appState.campaignPriorityMode).toBe('priority-list-only');
      expect(state.appState.queue.map((game) => game.id)).toEqual(['game-2', 'game-1']);
      expect(saved).toBe(1);
    });

    test('reorders future campaigns while farming and protects the running campaign', async () => {
      const state = createMinimalState();
      const running = createGame({ id: 'game-running', campaignId: 'campaign-running' });
      const firstFuture = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      const secondFuture = createGame({ id: 'game-2', campaignId: 'campaign-2' });
      state.appState.queue = [running, firstFuture, secondFuture];
      state.appState.selectedGame = running;
      state.appState.isRunning = true;

      const reordered = await handleReorderQueue(
        state,
        { fromIndex: 2, toIndex: 1 },
        {
          onTrackActivity: async () => undefined,
          onSaveState: async () => undefined,
        },
      );

      expect(reordered.success).toBe(true);
      expect(state.appState.queue.map((game) => game.id)).toEqual(['game-running', 'game-2', 'game-1']);

      const protectsRunning = await handleReorderQueue(
        state,
        { fromIndex: 0, toIndex: 1 },
        {
          onTrackActivity: async () => undefined,
          onSaveState: async () => undefined,
        },
      );

      expect(protectsRunning).toEqual({
        success: false,
        error: 'Cannot reorder the running campaign.',
      });
      expect(state.appState.queue.map((game) => game.id)).toEqual(['game-running', 'game-2', 'game-1']);
    });
  });
}
