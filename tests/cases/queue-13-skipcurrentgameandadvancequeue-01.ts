import { describe, expect, test } from 'bun:test';
import { skipCurrentGameAndAdvanceQueue } from '../../src/background/session-lifecycle.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import './queue-13-skipcurrentgameandadvancequeue-02.ts';

export function registerQueue13Part01() {
  describe('skipCurrentGameAndAdvanceQueue', () => {
    test('retains no-streamers game and opens the next queued game', async () => {
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

        expect(state.appState.queue.some((game) => game.id === current.id)).toBe(true);
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
        expect(notification?.title).toBe('Campaign queued: waiting for streamers');
        expect(notification?.message).toContain('Kept No Live Game queued for retry');
        expect(notification?.message).toContain('no eligible streamer was found for its Drops');
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
        expect(notification?.message).not.toContain('no eligible streamer');
        expect(mocks.notifications._notifications).toEqual([]);
      } finally {
        mocks.teardown();
      }
    });

    test('parks a stall-blocked campaign at the queue tail and advances to an unblocked campaign', async () => {
      // Given: the stalled campaign has exhausted recovery and another campaign remains eligible.
      const current = createGame({ id: 'game-1', campaignId: 'campaign-1', name: 'Blocked Game' });
      const next = createGame({ id: 'game-2', campaignId: 'campaign-2', name: 'Next Game' });
      const state = createMinimalState();
      state.appState.selectedGame = current;
      state.appState.queue = [current, next];
      state.appState.stalledCampaignBlocksByKey = {
        [gameKey(current)]: { blockedAt: 1, rotationAttempts: 3, eligibleStreamerNames: ['old-channel'] },
      };

      // When: the stalled session advances its queue.
      await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
        onSaveTimingState: async () => {},
        onOpenStreamer: async () => true,
      });

      // Then: the blocked campaign remains durable at the tail and is not selected again.
      expect({
        selected: state.appState.selectedGame?.campaignId,
        queue: state.appState.queue.map((game) => game.campaignId),
      }).toEqual({
        selected: 'campaign-2',
        queue: ['campaign-2', 'campaign-1'],
      });
    });

    test('clears a terminal manual authorization without retaining a blocked campaign as a new implicit queue', async () => {
      // Given: the only authorized manual campaign is blocked after exhausted recovery.
      const current = createGame({ id: 'game-1', campaignId: 'campaign-1', name: 'Blocked Game' });
      const state = createMinimalState();
      state.appState.manualQueueAuthorized = true;
      state.appState.selectedGame = current;
      state.appState.queue = [current];
      state.appState.stalledCampaignBlocksByKey = {
        [gameKey(current)]: { blockedAt: 1, rotationAttempts: 3, eligibleStreamerNames: ['old-channel'] },
      };

      // When: the blocked campaign has no eligible successor.
      await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
        onStopFarmingSession: async () => undefined,
      });

      // Then: the session cannot authorize later manual campaigns implicitly, while retry evidence retains context.
      expect({
        manualQueueAuthorized: state.appState.manualQueueAuthorized,
        queue: state.appState.queue.map((game) => game.campaignId),
      }).toEqual({ manualQueueAuthorized: false, queue: ['campaign-1'] });
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

    test('waits without a terminal stop when only a temporarily unavailable campaign remains', async () => {
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

      expect(stopReason).toBeNull();
      expect(stopMessage).toBeNull();
      expect(state.appState.queue).toEqual([current]);
      expect(state.appState.recoveryReason).toBe('no-streamers');
    });

    test('replaces stale stalled recovery with a bounded streamer retry when all campaigns wait', async () => {
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

      expect(state.appState.recoveryReason).toBe('no-streamers');
      expect(state.appState.recoveryBackoffUntil).toBeGreaterThan(Date.now());
      expect(state.appState.recoveryAttempts).toBe(1);
      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.recoveryBackoffUntil).toBeLessThanOrEqual(Date.now() + 60_000);
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
      expect(notification?.message).not.toContain('No eligible streamer was found');
    });
  });
}
