import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyStopState } from '../../src/background/recovery-state.ts';
import { advanceQueueIfCompleted } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue15Part03() {
  describe('advanceQueueIfCompleted', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('keeps ordinary all-acquired queue completion unchanged', async () => {
      // Given: the selected campaign has acquired every reward.
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [];
      state.previousAllDropsCount = 1;

      let stopMonitoringCalled = false;
      const alerts: Array<{ kind: string; message: string }> = [];

      // When: lifecycle advancement reaches the end of the queue.
      await advanceQueueIfCompleted(state, {
        onStopMonitoring: () => {
          stopMonitoringCalled = true;
        },
        onSendAlert: async (kind, message) => {
          alerts.push({ kind, message });
        },
        onApplyStopState: applyStopState,
      });

      // Then: the legacy queue-complete stop and all-complete alert remain intact.
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.lastStopReason).toBe('queue-complete');
      expect(state.appState.lastStopMessage).toBe('Queue completed. No pending rewards left.');
      expect(stopMonitoringCalled).toBe(true);
      expect(alerts).toEqual([
        { kind: 'all-complete', message: 'Queue completed. No pending rewards left.' },
      ]);
    });

    test('keeps ordinary expired queue completion unchanged', async () => {
      // Given: the selected campaign vanished after previously exposing rewards.
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'expired-game' });
      state.appState.allDrops = [];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [];
      state.previousAllDropsCount = 1;
      const alerts: Array<{ kind: string; message: string }> = [];

      // When: lifecycle advancement reaches the end of the queue.
      const advanced = await advanceQueueIfCompleted(state, {
        onApplyStopState: applyStopState,
        onSendAlert: async (kind, message) => {
          alerts.push({ kind, message });
        },
      });

      // Then: expiration still follows ordinary queue completion.
      expect(advanced).toBe(false);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.lastStopReason).toBe('queue-complete');
      expect(state.appState.lastStopMessage).toBe('Queue completed. No pending rewards left.');
      expect(alerts).toEqual([
        { kind: 'all-complete', message: 'Queue completed. No pending rewards left.' },
      ]);
    });

    test('closes managed tab when queue completes', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [createDrop({ claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [];
      state.appState.tabId = 123;
      state.previousAllDropsCount = 1;

      let closeTabCalled = false;
      await advanceQueueIfCompleted(state, {
        onCloseManagedTabIfSafe: async () => {
          closeTabCalled = true;
          return true;
        },
        onClearManagedTabOwnership: () => {},
        onApplyStopState: () => {},
        onStopMonitoring: () => {},
        onSendAlert: async () => {},
      });

      expect(closeTabCalled).toBe(true);
    });

    test('calls onSaveTimingState during advancement', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [createDrop({ claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [createGame({ id: 'game-2' })];
      state.previousAllDropsCount = 1;

      let saveTimingCalled = false;
      await advanceQueueIfCompleted(state, {
        onSaveTimingState: async () => {
          saveTimingCalled = true;
        },
        onOpenStreamer: async () => true,
      });

      expect(saveTimingCalled).toBe(true);
    });

    test('resets tracking state when advancing to next game', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [createDrop({ claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [createGame({ id: 'game-2' })];
      state.previousAllDropsCount = 1;
      state.invalidStreamChecks = 5;
      state.lastTrackedProgress = 50;

      await advanceQueueIfCompleted(state, {
        onOpenStreamer: async () => true,
      });

      expect(state.invalidStreamChecks).toBe(0);
      expect(state.lastTrackedProgress).toBe(-1);
      expect(state.previousAllDropsCount).toBe(0);
    });

    test('advances when campaign expired or vanished', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.appState.queue = [createGame({ id: 'game-2' })];
      state.previousAllDropsCount = 5;

      let openStreamerCalled = false;
      await advanceQueueIfCompleted(state, {
        onOpenStreamer: async () => {
          openStreamerCalled = true;
          return true;
        },
      });

      expect(state.appState.selectedGame?.id).toBe('game-2');
      expect(openStreamerCalled).toBe(true);
    });
  });
}
