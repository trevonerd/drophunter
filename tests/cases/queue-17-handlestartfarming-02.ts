import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { handleStartFarming } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue17Part02() {
  describe('handleStartFarming', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('calls onSaveState on success', async () => {
      const state = createMinimalState();
      state.appState.pendingDrops = [createDrop()];

      let saveStateCalled = false;
      await handleStartFarming(
        state,
        { game: createGame() },
        {
          onSaveState: async () => {
            saveStateCalled = true;
          },
        },
      );

      expect(saveStateCalled).toBe(true);
    });

    test('removes existing game from queue before adding to front', async () => {
      const state = createMinimalState();
      const otherGame = createGame({ id: 'other', name: 'Other Game' });
      const game = createGame({ id: 'game-1', name: 'Game One' });
      state.appState.queue = [otherGame, game];
      state.appState.pendingDrops = [createDrop()];
      state.appState.availableGames = [otherGame, game];

      await handleStartFarming(state, { game });

      const game1Count = state.appState.queue.filter((g) => g.id === 'game-1').length;
      expect(game1Count).toBe(1);
      expect(state.appState.queue[0].id).toBe('game-1');
    });
  });
}
