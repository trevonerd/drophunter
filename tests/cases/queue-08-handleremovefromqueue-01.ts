import { describe, expect, test } from 'bun:test';
import { handleRemoveFromQueue } from '../../src/background/drops-tick.ts';
import { removeGameFromQueue } from '../../src/background/queue-operations.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue08Part01() {
  describe('handleRemoveFromQueue', () => {
    const callbacks = {
      onTrackActivity: async () => undefined,
      onSaveState: async () => undefined,
    };
    const deps = {
      removeGameFromQueue,
      sameCampaignId: (left?: string | null, right?: string | null) =>
        Boolean(left && right && left === right),
    };

    test('allows removing a future campaign while farming', async () => {
      const running = createGame({ id: 'game-running', campaignId: 'campaign-running' });
      const future = createGame({ id: 'game-future', campaignId: 'campaign-future' });
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = running;
      state.appState.queue = [running, future];

      const result = await handleRemoveFromQueue(state, { game: future }, callbacks, deps);

      expect(result).toEqual({ success: true, removed: 1, queueLength: 1 });
      expect(state.appState.queue).toEqual([running]);
    });

    test('rejects removing the running campaign while farming', async () => {
      const running = createGame({ id: 'game-running', campaignId: 'campaign-running' });
      const future = createGame({ id: 'game-future', campaignId: 'campaign-future' });
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = running;
      state.appState.queue = [running, future];

      const result = await handleRemoveFromQueue(state, { game: running }, callbacks, deps);

      expect(result).toEqual({
        success: false,
        removed: 0,
        queueLength: 2,
        error: 'Cannot remove the running campaign.',
      });
      expect(state.appState.queue).toEqual([running, future]);
    });

    test('returns removed zero when the requested campaign is not queued', async () => {
      const queued = createGame({ id: 'game-queued', campaignId: 'campaign-queued' });
      const missing = createGame({ id: 'game-missing', campaignId: 'campaign-missing' });
      const state = createMinimalState();
      state.appState.queue = [queued];

      const result = await handleRemoveFromQueue(state, { game: missing }, callbacks, deps);

      expect(result).toEqual({ success: true, removed: 0, queueLength: 1 });
    });
  });
}
