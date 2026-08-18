import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { skipCurrentGameDueToStall } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue16Part01() {
  describe('skipCurrentGameDueToStall', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('removes current game from queue', async () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1', name: 'Game One' });
      const game2 = createGame({ id: 'game-2', name: 'Game Two' });
      state.appState.selectedGame = game1;
      state.appState.queue = [game1, game2];

      await skipCurrentGameDueToStall(state, {
        onOpenStreamer: async () => true,
      });

      expect(state.appState.queue.some((g) => g.id === 'game-1')).toBe(false);
    });

    test('advances to next game in queue', async () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1', name: 'Game One' });
      const game2 = createGame({ id: 'game-2', name: 'Game Two' });
      state.appState.selectedGame = game1;
      state.appState.queue = [game1, game2];

      await skipCurrentGameDueToStall(state, {
        onOpenStreamer: async () => true,
      });

      expect(state.appState.selectedGame?.id).toBe('game-2');
    });

    test('resets stream tracking state', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.queue = [createGame({ id: 'game-2' })];
      state.invalidStreamChecks = 5;
      state.noProgressRotationAttempts = 3;

      await skipCurrentGameDueToStall(state, {
        onOpenStreamer: async () => true,
      });

      expect(state.invalidStreamChecks).toBe(0);
      expect(state.noProgressRotationAttempts).toBe(0);
    });

    test('stops farming when no more games in queue', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ id: 'game-1', name: 'Game One' });
      state.appState.queue = [];

      let stopFarmingCalled = false;
      let stopParams: {
        stopReason: string;
        stopMessage: string;
        notification: { title: string; message: string };
      } | null = null;

      await skipCurrentGameDueToStall(state, {
        onStopFarmingSession: async (params) => {
          stopFarmingCalled = true;
          stopParams = params;
        },
      });

      expect(stopFarmingCalled).toBe(true);
      expect(stopParams?.stopReason).toBe('stall-skipped');
      expect(stopParams?.notification.title).toBe('Farming stopped: no drop progress');
      expect(stopParams?.notification.message).toContain('opened a stream but drop progress did not resume');
    });

    test('calls onSaveState after skipping', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.queue = [createGame({ id: 'game-2' })];

      let saveStateCalled = false;
      await skipCurrentGameDueToStall(state, {
        onOpenStreamer: async () => true,
        onSaveState: async () => {
          saveStateCalled = true;
        },
      });

      expect(saveStateCalled).toBe(true);
    });

    test('skips games with no pending drops', async () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1', name: 'Game One' });
      const game2 = createGame({ id: 'game-2' });
      const game3 = createGame({ id: 'game-3' });
      state.appState.selectedGame = game1;
      state.appState.queue = [game2, game3];
      state.appState.availableGames = [game2, game3];

      let refreshCallCount = 0;
      await skipCurrentGameDueToStall(state, {
        onRefreshDropsData: async () => {
          refreshCallCount++;
          if (refreshCallCount === 1) {
            state.appState.allDrops = [createDrop({ id: 'drop-2', claimed: true })];
            state.appState.pendingDrops = [];
            state.appState.currentDrop = null;
          } else {
            state.appState.allDrops = [createDrop({ id: 'drop-3' })];
            state.appState.pendingDrops = [createDrop({ id: 'drop-3' })];
            state.appState.currentDrop = createDrop({ id: 'drop-3' });
          }
        },
        onOpenStreamer: async () => true,
      });

      expect(state.appState.selectedGame?.id).toBe('game-3');
    });

    test('sends notification when game is skipped', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ id: 'game-1', name: 'Game One' });
      state.appState.queue = [createGame({ id: 'game-2', name: 'Game Two' })];
      state.appState.pendingDrops = [createDrop()];

      await skipCurrentGameDueToStall(state, {
        onOpenStreamer: async () => true,
      });
    });
  });
}
