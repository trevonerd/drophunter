import { describe, expect, test } from 'bun:test';
import { normalizeQueueSelection } from '../../src/background/queue-operations.ts';
import { createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue01Part01() {
  describe('normalizeQueueSelection', () => {
    test('clears queue if queue is not an array', () => {
      const state = createMinimalState();
      Object.defineProperty(state.appState, 'queue', { value: null, writable: true });
      normalizeQueueSelection(state, []);
      expect(state.appState.queue).toEqual([]);
    });

    test('returns early if queue is empty', () => {
      const state = createMinimalState();
      state.appState.queue = [];
      normalizeQueueSelection(state, []);
      expect(state.appState.queue).toEqual([]);
    });

    test('removes expired games from queue', () => {
      const state = createMinimalState();
      const expiredGame = createGame({ id: 'expired', expiresInMs: -1 });
      const validGame = createGame({ id: 'valid', expiresInMs: 3600000 });
      state.appState.queue = [expiredGame, validGame];
      normalizeQueueSelection(state, [validGame]);
      expect(state.appState.queue).toHaveLength(1);
      expect(state.appState.queue[0].id).toBe('valid');
    });

    test('removes duplicate games from queue', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'duplicate' });
      state.appState.queue = [game, game, game];
      normalizeQueueSelection(state, [game]);
      expect(state.appState.queue).toHaveLength(1);
    });

    test('resolves games using findMatchingGame when available', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1', name: 'Original' });
      const resolvedGame = createGame({ id: 'game-1', name: 'Resolved', campaignId: 'campaign-1' });
      state.appState.queue = [game];
      normalizeQueueSelection(state, [resolvedGame]);
      expect(state.appState.queue[0].id).toBe('game-1');
      expect(state.appState.queue[0].campaignId).toBe('campaign-1');
    });

    test('keeps a vanished game on the first miss and prunes only after consecutive confirmations', () => {
      const state = createMinimalState();
      const vanishedGame = createGame({ id: 'vanished', campaignId: 'campaign-gone' });
      state.appState.queue = [vanishedGame];
      normalizeQueueSelection(state, [], true);
      expect(state.appState.queue).toHaveLength(1);
      normalizeQueueSelection(state, [], true);
      expect(state.appState.queue).toHaveLength(0);
    });

    test('keeps vanished games in queue when dropVanished is false', () => {
      const state = createMinimalState();
      const vanishedGame = createGame({ id: 'vanished', campaignId: 'campaign-gone' });
      state.appState.queue = [vanishedGame];
      normalizeQueueSelection(state, [], false);
      expect(state.appState.queue).toHaveLength(1);
    });

    test('resets the missing streak when the game reappears', () => {
      const state = createMinimalState();
      const game = createGame({ id: 'flaky', campaignId: 'campaign-flaky' });
      state.appState.queue = [game];
      normalizeQueueSelection(state, [], true);
      expect(state.appState.queue).toHaveLength(1);
      normalizeQueueSelection(state, [game], true);
      expect(state.appState.queue).toHaveLength(1);
      normalizeQueueSelection(state, [], true);
      expect(state.appState.queue).toHaveLength(1);
      normalizeQueueSelection(state, [], true);
      expect(state.appState.queue).toHaveLength(0);
    });

    test('does not count misses toward the streak while within the crash-recovery grace window', () => {
      const state = createMinimalState();
      state.appState.resumedFromCrash = Date.now();
      const vanishedGame = createGame({ id: 'vanished', campaignId: 'campaign-gone' });
      state.appState.queue = [vanishedGame];
      normalizeQueueSelection(state, [], true);
      normalizeQueueSelection(state, [], true);
      normalizeQueueSelection(state, [], true);
      expect(state.appState.queue).toHaveLength(1);
    });

    test('regression: a partial post-resume snapshot does not wipe a multi-campaign queue', () => {
      const state = createMinimalState();
      state.appState.resumedFromCrash = Date.now() - 3 * 60_000; // grace window elapsed
      const museum = createGame({ id: 'museum', campaignId: 'campaign-museum' });
      const diablo = createGame({ id: 'diablo', campaignId: 'campaign-diablo' });
      state.appState.queue = [museum, diablo];
      // First post-grace snapshot only reports diablo (museum missing) — should survive.
      normalizeQueueSelection(state, [diablo], true);
      expect(state.appState.queue.map((g) => g.id)).toEqual(['museum', 'diablo']);
      // A second consecutive snapshot still missing museum confirms the prune.
      normalizeQueueSelection(state, [diablo], true);
      expect(state.appState.queue.map((g) => g.id)).toEqual(['diablo']);
    });
  });
}
