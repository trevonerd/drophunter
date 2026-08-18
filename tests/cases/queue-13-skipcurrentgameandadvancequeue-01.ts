import { describe, expect, test } from 'bun:test';
import { skipCurrentGameAndAdvanceQueue } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue13Part01() {
  describe('skipCurrentGameAndAdvanceQueue', () => {
    test('removes no-streamers game and opens the next queued game', async () => {
      const mocks = setupChromeMocks();
      const current = createGame({ id: 'game-1', name: 'No Live Game' });
      const next = createGame({ id: 'game-2', name: 'Live Game' });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current, next];

      try {
        let openedGame: string | null = null;
        await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
          onSaveTimingState: async () => {},
          onOpenStreamer: async () => {
            openedGame = state.appState.selectedGame?.id ?? null;
            return true;
          },
        });

        expect(state.appState.queue.some((game) => game.id === current.id)).toBe(false);
        expect(state.appState.selectedGame?.id).toBe(next.id);
        expect(openedGame).toBe(next.id);
      } finally {
        mocks.teardown();
      }
    });

    test('uses no-streamers-specific skip notification when moving to the next game', async () => {
      const mocks = setupChromeMocks();
      const current = createGame({ id: 'game-1', name: 'No Live Game' });
      const next = createGame({ id: 'game-2', name: 'Live Game' });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current, next];

      try {
        const notifications: Array<{ title: string; message: string }> = [];
        await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
          onSaveTimingState: async () => {},
          onOpenStreamer: async () => true,
          onNotify: async (title, message) => {
            notifications.push({ title, message });
          },
        });

        const notification = notifications[0];
        expect(notification?.title).toBe('Game skipped: no live streamers');
        expect(notification?.message).toContain('Skipped No Live Game');
        expect(notification?.message).toContain('no live streamers were found');
        expect(notification?.message).not.toContain('drop progress');
        expect(mocks.notifications._notifications).toEqual([]);
      } finally {
        mocks.teardown();
      }
    });

    test('uses stalled-progress-specific skip notification when moving to the next game', async () => {
      const mocks = setupChromeMocks();
      const current = createGame({ id: 'game-1', name: 'Stalled Game' });
      const next = createGame({ id: 'game-2', name: 'Live Game' });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current, next];

      try {
        const notifications: Array<{ title: string; message: string }> = [];
        await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
          onSaveTimingState: async () => {},
          onOpenStreamer: async () => true,
          onNotify: async (title, message) => {
            notifications.push({ title, message });
          },
        });

        const notification = notifications[0];
        expect(notification?.title).toBe('Game skipped: no drop progress');
        expect(notification?.message).toContain('Skipped Stalled Game');
        expect(notification?.message).toContain('stream opened but drop progress did not resume');
        expect(notification?.message).not.toContain('no live streamers');
        expect(mocks.notifications._notifications).toEqual([]);
      } finally {
        mocks.teardown();
      }
    });

    test('skips farming-complete queue entries after a stalled campaign', async () => {
      const current = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      const terminalGame = createGame({
        id: 'game-2',
        campaignId: 'campaign-2',
        rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
      });
      const farmableGame = createGame({
        id: 'game-3',
        campaignId: 'campaign-3',
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current, terminalGame, farmableGame];
      state.appState.availableGames = [current, terminalGame, farmableGame];
      let refreshCalls = 0;

      await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
        onSaveTimingState: async () => {},
        onRefreshDropsData: async () => {
          refreshCalls += 1;
          if (refreshCalls === 1) {
            const terminalDrop = createDrop({
              id: 'terminal-drop',
              campaignId: terminalGame.campaignId,
              rewardKind: 'twitch-emote',
              verificationState: 'unverifiable',
            });
            state.appState.selectedGame = terminalGame;
            state.appState.allDrops = [terminalDrop];
            state.appState.pendingDrops = [terminalDrop];
            state.appState.currentDrop = null;
            return;
          }
          const farmableDrop = createDrop({ id: 'farmable-drop', campaignId: farmableGame.campaignId });
          state.appState.selectedGame = farmableGame;
          state.appState.allDrops = [farmableDrop];
          state.appState.pendingDrops = [farmableDrop];
          state.appState.currentDrop = farmableDrop;
        },
        onOpenStreamer: async () => true,
      });

      expect(refreshCalls).toBe(2);
      expect(state.appState.selectedGame).toBe(farmableGame);
      expect(state.appState.queue).toEqual([farmableGame]);
    });

    test('stops cleanly when no-streamers skip exhausts the queue', async () => {
      const current = createGame({ id: 'game-1', name: 'No Live Game' });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current];

      let stopReason: string | null = null;
      let stopMessage: string | null = null;
      await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
        onStopFarmingSession: async (opts) => {
          stopReason = opts.stopReason;
          stopMessage = opts.stopMessage;
        },
      });

      expect(stopReason).toBe('queue-complete');
      expect(stopMessage).toContain('Queue completed');
      expect(stopMessage).toContain('No live streamers found');
    });

    test('clears stale stalled recovery when no-streamers skip exhausts the queue', async () => {
      const current = createGame({ id: 'game-1', name: 'No Live Game' });
      const state = createMinimalState({
        stalledRecoveryAttempts: 3,
        recoveryBackoffUntil: Date.now() + 60_000,
      });
      state.appState.selectedGame = current;
      state.appState.queue = [current];
      state.appState.recoveryReason = 'stalled-progress';
      state.appState.recoveryBackoffUntil = state.recoveryBackoffUntil;
      state.appState.recoveryAttempts = 3;

      await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
        onStopFarmingSession: async () => {
          state.appState.isRunning = false;
          state.appState.isPaused = false;
          state.appState.selectedGame = null;
          state.appState.activeStreamer = null;
          state.appState.tabId = null;
        },
      });

      expect(state.appState.recoveryReason).toBeNull();
      expect(state.appState.recoveryBackoffUntil).toBeNull();
      expect(state.appState.recoveryAttempts).toBeNull();
      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.recoveryBackoffUntil).toBe(0);
    });

    test('uses stalled-progress-specific terminal notification when no games remain', async () => {
      const current = createGame({ id: 'game-1', name: 'Stalled Game' });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current];

      let notification: { title: string; message: string } | null = null;
      await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
        onStopFarmingSession: async (opts) => {
          notification = opts.notification;
        },
      });

      expect(notification?.title).toBe('Farming stopped: no drop progress');
      expect(notification?.message).toContain('Stalled Game');
      expect(notification?.message).toContain('opened a stream but drop progress did not resume');
      expect(notification?.message).not.toContain('No live streamers found');
    });

    test('uses truthful unverifiable-Twitch terminal state when no games remain', async () => {
      const current = createGame({
        id: 'game-1',
        name: 'Unverifiable Game',
        rewardSummary: {
          completion: 'farming-complete',
          remainderReasons: ['unverifiable-twitch'],
        },
      });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current];

      let stop:
        | { stopReason: string; stopMessage: string; notification: { title: string; message: string } }
        | undefined;
      await skipCurrentGameAndAdvanceQueue(state, 'unverifiable-twitch', {
        onStopFarmingSession: async (options) => {
          stop = options;
        },
      });

      expect(stop?.stopReason).toBe('unverifiable-twitch');
      expect(stop?.stopMessage).toContain('could not be verified');
      expect(stop?.notification.message).toContain('could not be verified');
      expect(stop?.stopMessage).not.toMatch(/all rewards (claimed|acquired|complete)/i);
      expect(state.appState.selectedGame).toEqual(current);
    });

    test('advances with truthful unverifiable-Twitch copy when another game is queued', async () => {
      const current = createGame({ id: 'game-1', name: 'Unverifiable Game', campaignId: 'campaign-1' });
      const next = createGame({ id: 'game-2', name: 'Farmable Game', campaignId: 'campaign-2' });
      const nextDrop = createDrop({ id: 'next-drop', campaignId: next.campaignId });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current, next];
      state.appState.availableGames = [current, next];
      const notifications: Array<{ title: string; message: string }> = [];

      await skipCurrentGameAndAdvanceQueue(state, 'unverifiable-twitch', {
        onSaveTimingState: async () => {},
        onRefreshDropsData: async () => {
          state.appState.allDrops = [nextDrop];
          state.appState.pendingDrops = [nextDrop];
          state.appState.currentDrop = nextDrop;
        },
        onOpenStreamer: async () => true,
        onNotify: async (title, message) => {
          notifications.push({ title, message });
        },
      });

      expect(state.appState.selectedGame?.campaignId).toBe(next.campaignId);
      expect(state.appState.queue).toEqual([next]);
      expect(notifications[0]?.title).toBe('Campaign farming finished');
      expect(notifications[0]?.message).toContain('could not be verified');
      expect(notifications[0]?.message).toContain('Now farming Farmable Game');
      expect(notifications[0]?.message).not.toMatch(/all rewards (claimed|acquired|complete)/i);
    });
  });
}
