import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { advanceQueueIfCompleted } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue15Part01() {
  describe('advanceQueueIfCompleted', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('returns false when not running', async () => {
      const state = createMinimalState();
      state.appState.isRunning = false;
      const result = await advanceQueueIfCompleted(state, {});
      expect(result).toBe(false);
    });

    test('returns false when paused', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.isPaused = true;
      const result = await advanceQueueIfCompleted(state, {});
      expect(result).toBe(false);
    });

    test('returns true and advances when no drops are pending and all completed', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      const game1 = createGame({ id: 'game-1' });
      const game2 = createGame({ id: 'game-2' });
      state.appState.selectedGame = game1;
      state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      state.previousAllDropsCount = 1;
      state.appState.queue = [game2];
      state.appState.availableGames = [game2];

      const result = await advanceQueueIfCompleted(state, {
        onOpenStreamer: async () => true,
        onRefreshDropsData: async () => {
          state.appState.allDrops = [createDrop({ id: 'drop-2' })];
          state.appState.pendingDrops = [createDrop({ id: 'drop-2' })];
          state.appState.currentDrop = createDrop({ id: 'drop-2' });
        },
      });

      expect(result).toBe(true);
      expect(state.appState.selectedGame?.id).toBe('game-2');
    });

    test('advances stale campaigns when only known non-farmable rewards remain', async () => {
      const state = createMinimalState();
      const roblox = createGame({ id: 'roblox', name: 'Roblox' });
      const next = createGame({ id: 'next', name: 'Next game' });
      state.appState.isRunning = true;
      state.appState.selectedGame = roblox;
      state.appState.queue = [roblox, next];
      state.appState.availableGames = [roblox, next];
      state.appState.allDrops = [];
      state.appState.pendingDrops = [
        createDrop({
          id: 'subscriber-emote',
          gameId: 'roblox',
          gameName: 'Roblox',
          acquisitionMethod: 'subscription',
          rewardKind: 'twitch-emote',
        }),
      ];
      state.appState.currentDrop = null;

      await advanceQueueIfCompleted(state, {
        onRefreshDropsData: async () => {
          state.appState.pendingDrops = [createDrop({ id: 'next-drop', gameId: 'next' })];
          state.appState.currentDrop = state.appState.pendingDrops[0] ?? null;
        },
        onOpenStreamer: async () => true,
      });

      expect(state.appState.selectedGame?.id).toBe('next');
      expect(state.appState.queue.some((game) => game.id === 'roblox')).toBe(false);
    });

    test('advances to next game in queue when current completed', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1' });
      state.appState.allDrops = [createDrop({ id: 'drop-1', claimed: true })];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      const nextGame = createGame({ id: 'game-2' });
      state.appState.queue = [nextGame];
      state.appState.availableGames = [nextGame];
      state.previousAllDropsCount = 1;

      let openStreamerCalled = false;
      await advanceQueueIfCompleted(state, {
        onOpenStreamer: async () => {
          openStreamerCalled = true;
          return true;
        },
        onRefreshDropsData: async () => {
          state.appState.pendingDrops = [createDrop({ id: 'drop-2' })];
          state.appState.currentDrop = createDrop({ id: 'drop-2' });
        },
      });

      expect(state.appState.selectedGame?.id).toBe('game-2');
      expect(openStreamerCalled).toBe(true);
    });

    test('advances when selected game is marked completed but drop split is empty', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      state.appState.selectedGame = createGame({ id: 'game-1', allDropsCompleted: true });
      state.appState.allDrops = [];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      const nextGame = createGame({ id: 'game-2' });
      state.appState.queue = [nextGame];
      state.appState.availableGames = [createGame({ id: 'game-1', allDropsCompleted: true }), nextGame];

      let openStreamerCalled = false;
      await advanceQueueIfCompleted(state, {
        onOpenStreamer: async () => {
          openStreamerCalled = true;
          return true;
        },
        onRefreshDropsData: async () => {
          state.appState.allDrops = [createDrop({ id: 'drop-2', gameId: 'game-2', gameName: 'Game Two' })];
          state.appState.pendingDrops = [
            createDrop({ id: 'drop-2', gameId: 'game-2', gameName: 'Game Two' }),
          ];
          state.appState.currentDrop = createDrop({ id: 'drop-2', gameId: 'game-2', gameName: 'Game Two' });
        },
      });

      expect(state.appState.selectedGame?.id).toBe('game-2');
      expect(openStreamerCalled).toBe(true);
    });

    test('skips a stale queued copy that resolves back to the completed campaign', async () => {
      const state = createMinimalState();
      state.appState.isRunning = true;
      const completedGame = createGame({
        id: 'canonical-completed-id',
        name: 'Same Game',
        campaignId: 'campaign-completed',
        allDropsCompleted: true,
      });
      const staleQueuedCopy = createGame({
        id: 'legacy-same-game-id',
        name: 'Same Game',
        campaignId: undefined,
      });
      const nextGame = createGame({
        id: 'game-next',
        name: 'Next Game',
        campaignId: 'campaign-next',
      });
      state.appState.selectedGame = completedGame;
      state.appState.availableGames = [completedGame, nextGame];
      state.appState.queue = [staleQueuedCopy, nextGame];
      state.appState.allDrops = [];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;

      let refreshCallCount = 0;
      let openStreamerCalled = false;
      await advanceQueueIfCompleted(state, {
        onRefreshDropsData: async () => {
          refreshCallCount += 1;
          if (refreshCallCount === 1) {
            const nextDrop = createDrop({
              id: 'drop-next',
              gameId: nextGame.id,
              gameName: nextGame.name,
              campaignId: nextGame.campaignId,
            });
            state.appState.allDrops = [nextDrop];
            state.appState.pendingDrops = [nextDrop];
            state.appState.currentDrop = nextDrop;
          }
        },
        onOpenStreamer: async () => {
          openStreamerCalled = true;
          return true;
        },
      });

      expect(refreshCallCount).toBe(1);
      expect(state.appState.selectedGame?.campaignId).toBe('campaign-next');
      expect(state.appState.queue.map((game) => game.campaignId)).toEqual(['campaign-next']);
      expect(openStreamerCalled).toBe(true);
    });

    test('promotes a farmable sibling when a terminal campaign shares its game id', async () => {
      // Given: the selected terminal campaign is first, followed by a distinct farmable sibling.
      const state = createMinimalState();
      const terminalCampaign = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-terminal',
        rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
      });
      const farmableSibling = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-farmable',
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      });
      state.appState.isRunning = true;
      state.appState.selectedGame = terminalCampaign;
      state.appState.availableGames = [terminalCampaign, farmableSibling];
      state.appState.queue = [terminalCampaign, farmableSibling];
      state.appState.allDrops = [];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;
      const events: string[] = [];

      // When: lifecycle advancement removes the terminal selection and starts the next campaign.
      const advanced = await advanceQueueIfCompleted(state, {
        onSaveTimingState: async () => {
          events.push(`timing:${state.appState.selectedGame?.campaignId ?? 'none'}`);
        },
        onEnsureWorkspace: async () => {
          events.push(`workspace:${state.appState.selectedGame?.campaignId ?? 'none'}`);
        },
        onRefreshDropsData: async () => {
          events.push(`refresh:${state.appState.selectedGame?.campaignId ?? 'none'}`);
          const siblingDrop = createDrop({
            id: 'sibling-drop',
            gameId: farmableSibling.id,
            gameName: farmableSibling.name,
            campaignId: farmableSibling.campaignId,
          });
          state.appState.allDrops = [siblingDrop];
          state.appState.pendingDrops = [siblingDrop];
          state.appState.currentDrop = siblingDrop;
        },
        onOpenStreamer: async () => {
          events.push(`open:${state.appState.selectedGame?.campaignId ?? 'none'}`);
          return true;
        },
        onSaveState: async () => {
          events.push(`persist:${state.appState.selectedGame?.campaignId ?? 'none'}`);
        },
      });

      // Then: only the exact terminal campaign is removed and the sibling remains running.
      expect(advanced).toBe(true);
      expect(state.appState.selectedGame).toBe(farmableSibling);
      expect(state.appState.selectedGame?.campaignId).toBe('campaign-farmable');
      expect(state.appState.queue).toEqual([farmableSibling]);
      expect(state.appState.isRunning).toBe(true);
      expect(events).toEqual([
        'timing:campaign-farmable',
        'workspace:campaign-farmable',
        'refresh:campaign-farmable',
        'open:campaign-farmable',
        'persist:campaign-farmable',
      ]);
    });
  });
}
