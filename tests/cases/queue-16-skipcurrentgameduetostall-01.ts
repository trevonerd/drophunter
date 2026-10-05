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

    test('parks current game in the queue for the next round', async () => {
      const state = createMinimalState();
      const game1 = createGame({ id: 'game-1', name: 'Game One' });
      const game2 = createGame({ id: 'game-2', name: 'Game Two' });
      state.appState.selectedGame = game1;
      state.appState.queue = [game1, game2];

      await skipCurrentGameDueToStall(state, {
        onOpenStreamer: async () => true,
      });

      expect(state.appState.queue.some((g) => g.id === 'game-1')).toBe(true);
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

    test('retains the selected campaign when no successor is queued', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ id: 'game-1', name: 'Game One' });
      state.appState.queue = [];

      let stopFarmingCalled = false;
      const captured: {
        stopParams: {
          stopReason: string;
          stopMessage: string;
          notification: { title: string; message: string };
        } | null;
      } = { stopParams: null };

      await skipCurrentGameDueToStall(state, {
        onStopFarmingSession: async (params) => {
          stopFarmingCalled = true;
          captured.stopParams = params;
        },
      });

      expect(stopFarmingCalled).toBe(false);
      expect(captured.stopParams).toBeNull();
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.queue).toHaveLength(1);
      expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBeGreaterThan(Date.now());
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
