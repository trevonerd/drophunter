import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyStopState } from '../../src/background/recovery-state.ts';
import { advanceQueueIfCompleted } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue15Part02() {
  describe('advanceQueueIfCompleted', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('skips completed games in queue', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      const game2 = createGame({ id: 'game-2' });
      const game3 = createGame({ id: 'game-3' });
      state.appState.queue = [game2, game3];
      state.appState.availableGames = [game2, game3];
      state.previousAllDropsCount = 1;

      let refreshCallCount = 0;
      await advanceQueueIfCompleted(state, {
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

    test('skips queued farming-complete campaigns and advances to the next farmable campaign', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.previousAllDropsCount = 1;
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
      state.appState.queue = [terminalGame, farmableGame];
      state.appState.availableGames = [terminalGame, farmableGame];
      let refreshCalls = 0;

      await advanceQueueIfCompleted(state, {
        onRefreshDropsData: async () => {
          refreshCalls += 1;
          if (refreshCalls === 1) {
            const terminalDrop = createDrop({
              id: 'terminal-drop',
              campaignId: terminalGame.campaignId,
              rewardKind: 'twitch-badge',
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

    test('retains a subscription-only campaign when farming-complete exhausts the queue', async () => {
      // Given: the selected campaign has only a subscription-gated remainder and no queued successor.
      const state = createMinimalState();
      const terminalGame = createGame({
        id: 'subscription-game',
        name: 'Subscription Game',
        campaignId: 'subscription-campaign',
        rewardSummary: {
          completion: 'farming-complete',
          remainderReasons: ['subscription-required'],
        },
      });
      state.appState.isRunning = true;
      state.appState.selectedGame = terminalGame;
      state.appState.availableGames = [terminalGame];
      state.appState.queue = [terminalGame];
      state.appState.allDrops = [
        createDrop({
          id: 'subscription-reward',
          campaignId: terminalGame.campaignId,
          acquisitionMethod: 'subscription',
        }),
      ];
      state.appState.pendingDrops = [...state.appState.allDrops];
      state.appState.currentDrop = null;
      const alerts: Array<{ kind: string; message: string }> = [];

      // When: lifecycle advancement reaches the end of the queue.
      const advanced = await advanceQueueIfCompleted(state, {
        onApplyStopState: applyStopState,
        onSendAlert: async (kind, message) => {
          alerts.push({ kind, message });
        },
      });

      // Then: terminal state keeps the campaign inspectable and does not announce all acquired.
      expect(advanced).toBe(false);
      expect(state.appState.selectedGame).toEqual(terminalGame);
      expect(state.appState.lastStopReason).toBe('farming-complete');
      expect(state.appState.lastStopMessage).toBe(
        'All farmable rewards claimed · Subscription required for remaining rewards',
      );
      expect(alerts).toEqual([]);
    });

    test('retains an unverifiable-only campaign when farming-complete exhausts the queue', async () => {
      // Given: the selected campaign has only an unverifiable Twitch-native remainder.
      const state = createMinimalState();
      const terminalGame = createGame({
        id: 'unverifiable-game',
        name: 'Unverifiable Game',
        campaignId: 'unverifiable-campaign',
        rewardSummary: {
          completion: 'farming-complete',
          remainderReasons: ['unverifiable-twitch'],
        },
      });
      state.appState.isRunning = true;
      state.appState.selectedGame = terminalGame;
      state.appState.availableGames = [terminalGame];
      state.appState.queue = [terminalGame];
      state.appState.allDrops = [
        createDrop({
          id: 'unverifiable-reward',
          campaignId: terminalGame.campaignId,
          rewardKind: 'twitch-emote',
          verificationState: 'unverifiable',
        }),
      ];
      state.appState.pendingDrops = [...state.appState.allDrops];
      state.appState.currentDrop = null;
      const alerts: Array<{ kind: string; message: string }> = [];

      // When: lifecycle advancement reaches the end of the queue.
      const advanced = await advanceQueueIfCompleted(state, {
        onApplyStopState: applyStopState,
        onSendAlert: async (kind, message) => {
          alerts.push({ kind, message });
        },
      });

      // Then: the terminal reason stays truthful and no all-complete alert is emitted.
      expect(advanced).toBe(false);
      expect(state.appState.selectedGame).toEqual(terminalGame);
      expect(state.appState.lastStopReason).toBe('unverifiable-twitch');
      expect(state.appState.lastStopMessage).toBe(
        'Farming finished · Twitch reward acquisition could not be verified',
      );
      expect(alerts).toEqual([]);
    });

    test('retains both ordered remainder lines when farming-complete exhausts the queue', async () => {
      // Given: the selected campaign has subscription and unverifiable remainders.
      const state = createMinimalState();
      const terminalGame = createGame({
        id: 'combined-game',
        name: 'Combined Game',
        campaignId: 'combined-campaign',
        rewardSummary: {
          completion: 'farming-complete',
          remainderReasons: ['unverifiable-twitch', 'subscription-required'],
        },
      });
      state.appState.isRunning = true;
      state.appState.selectedGame = terminalGame;
      state.appState.availableGames = [terminalGame];
      state.appState.queue = [terminalGame];
      state.appState.pendingDrops = [
        createDrop({ acquisitionMethod: 'subscription', campaignId: terminalGame.campaignId }),
        createDrop({
          id: 'unverifiable-reward',
          rewardKind: 'twitch-badge',
          verificationState: 'unverifiable',
          campaignId: terminalGame.campaignId,
        }),
      ];
      state.appState.allDrops = [...state.appState.pendingDrops];
      state.appState.currentDrop = null;
      const alerts: Array<{ kind: string; message: string }> = [];

      // When: lifecycle advancement reaches the end of the queue.
      const advanced = await advanceQueueIfCompleted(state, {
        onApplyStopState: applyStopState,
        onSendAlert: async (kind, message) => {
          alerts.push({ kind, message });
        },
      });

      // Then: the canonical subscription-then-unverifiable lines are persisted separately.
      expect(advanced).toBe(false);
      expect(state.appState.selectedGame).toEqual(terminalGame);
      expect(state.appState.lastStopReason).toBe('unverifiable-twitch');
      expect(state.appState.lastStopMessage?.split('\n')).toEqual([
        'All farmable rewards claimed · Subscription required for remaining rewards',
        'Farming finished · Twitch reward acquisition could not be verified',
      ]);
      expect(alerts).toEqual([]);
    });
  });
}
