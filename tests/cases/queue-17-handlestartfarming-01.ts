import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { handleStartFarming } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue17Part01() {
  describe('handleStartFarming', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('returns error when no game provided', async () => {
      const state = createMinimalState();
      const result = await handleStartFarming(state, {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('No game selected.');
    });

    test('rejects a farming-complete campaign before mutating the farming session', async () => {
      const state = createMinimalState();
      const terminalGame = createGame({
        id: 'terminal-game',
        campaignId: 'terminal-campaign',
        rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
      });
      const queuedGame = createGame({ id: 'queued-game', campaignId: 'queued-campaign' });
      state.appState.availableGames = [terminalGame, queuedGame];
      state.appState.queue = [queuedGame];
      state.appState.pendingDrops = [
        createDrop({
          campaignId: terminalGame.campaignId,
          rewardKind: 'twitch-badge',
          verificationState: 'unverifiable',
        }),
      ];
      let refreshCalls = 0;

      const result = await handleStartFarming(
        state,
        { game: terminalGame },
        {
          onRefreshDropsData: async () => {
            refreshCalls += 1;
          },
        },
      );

      expect(result).toEqual({
        success: false,
        error: 'Farming finished · Twitch reward acquisition could not be verified',
      });
      expect(refreshCalls).toBe(0);
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.queue).toEqual([queuedGame]);
    });

    test('tracks activity on start', async () => {
      const state = createMinimalState();
      let trackActivityCalled = false;
      await handleStartFarming(
        state,
        { game: createGame() },
        {
          onTrackActivity: async () => {
            trackActivityCalled = true;
          },
        },
      );
      expect(trackActivityCalled).toBe(true);
    });

    test('adds game to front of queue', async () => {
      const state = createMinimalState();
      const existingGame = createGame({ id: 'existing', name: 'Existing Game' });
      const newGame = createGame({ id: 'new', name: 'New Game' });
      state.appState.queue = [existingGame];
      state.appState.pendingDrops = [createDrop()];
      state.appState.availableGames = [existingGame, newGame];

      await handleStartFarming(state, { game: newGame });

      expect(state.appState.queue[0].id).toBe('new');
      expect(state.appState.queue[1].id).toBe('existing');
    });

    test('sets selected game to first in queue', async () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1' });
      state.appState.pendingDrops = [createDrop()];
      state.appState.availableGames = [game];

      await handleStartFarming(state, { game });

      expect(state.appState.selectedGame?.id).toBe('game-1');
    });

    test('sets isRunning to true and isPaused to false', async () => {
      const state = createMinimalState();
      state.appState.isRunning = false;
      state.appState.isPaused = true;
      state.appState.pendingDrops = [createDrop()];

      await handleStartFarming(state, { game: createGame() });

      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.isPaused).toBe(false);
    });

    test('clears stop state and recovery state', async () => {
      const state = createMinimalState();
      state.appState.lastStopReason = 'previous-stop';
      state.appState.recoveryReason = 'previous-recovery';
      state.stalledRecoveryAttempts = 3;

      await handleStartFarming(state, { game: createGame() });

      expect(state.appState.lastStopReason).toBeNull();
      expect(state.appState.lastStopMessage).toBeNull();
      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.appState.recoveryReason).toBeNull();
    });

    test('resets stream tracking state', async () => {
      const state = createMinimalState();
      state.invalidStreamChecks = 5;
      state.noProgressRotationAttempts = 3;

      await handleStartFarming(state, { game: createGame() });

      expect(state.invalidStreamChecks).toBe(0);
      expect(state.noProgressRotationAttempts).toBe(0);
    });

    test('returns error when no farmable drops available', async () => {
      const state = createMinimalState();
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;

      const result = await handleStartFarming(state, { game: createGame() });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No farmable drops for this game.');
      expect(state.appState.isRunning).toBe(false);
    });

    test('rejects Start when refresh makes the selected campaign farming-complete', async () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1', campaignId: 'campaign-1' });
      state.appState.availableGames = [game];

      const result = await handleStartFarming(
        state,
        { game },
        {
          onRefreshDropsData: async () => {
            const farmingCompleteGame = createGame({
              ...game,
              rewardSummary: { completion: 'farming-complete', remainderReasons: ['unverifiable-twitch'] },
            });
            state.appState.availableGames = [farmingCompleteGame];
            state.appState.selectedGame = farmingCompleteGame;
            state.appState.pendingDrops = [
              createDrop({
                campaignId: game.campaignId,
                rewardKind: 'twitch-emote',
                verificationState: 'unverifiable',
              }),
            ];
            state.appState.currentDrop = null;
          },
        },
      );

      expect(result).toEqual({
        success: false,
        error: 'Farming finished · Twitch reward acquisition could not be verified',
      });
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.selectedGame).toBeNull();
    });

    test('removes game from queue when no farmable drops', async () => {
      const state = createMinimalState();
      const game = createGame({ id: 'game-1' });
      state.appState.queue = [game];
      state.appState.pendingDrops = [];
      state.appState.currentDrop = null;

      await handleStartFarming(state, { game });

      expect(state.appState.queue.some((g) => g.id === 'game-1')).toBe(false);
    });

    test('calls onEnsureWorkspace', async () => {
      const state = createMinimalState();
      state.appState.pendingDrops = [createDrop()];

      let ensureWorkspaceCalled = false;
      await handleStartFarming(
        state,
        { game: createGame() },
        {
          onEnsureWorkspace: async () => {
            ensureWorkspaceCalled = true;
          },
        },
      );

      expect(ensureWorkspaceCalled).toBe(true);
    });

    test('calls onRefreshDropsData with correct options', async () => {
      const state = createMinimalState();
      state.appState.pendingDrops = [createDrop()];

      let refreshOptions: {
        includeCampaignFetch: boolean;
        includeInventoryFetch: boolean;
        suppressNotifications: boolean;
      } | null = null;
      await handleStartFarming(
        state,
        { game: createGame() },
        {
          onRefreshDropsData: async (options) => {
            refreshOptions = options;
          },
        },
      );

      expect(refreshOptions?.includeCampaignFetch).toBe(true);
      expect(refreshOptions?.includeInventoryFetch).toBe(true);
      expect(refreshOptions?.suppressNotifications).toBe(true);
    });

    test('clears drop claim state', async () => {
      const state = createMinimalState();
      state.appState.pendingDrops = [createDrop()];
      state.dropClaimRetryAtById.set('drop-1', Date.now());
      state.dropClaimInFlight = true;

      await handleStartFarming(state, { game: createGame() });

      expect(state.dropClaimRetryAtById.size).toBe(0);
      expect(state.dropClaimInFlight).toBe(false);
    });

    test('returns success when farmable drops exist', async () => {
      const state = createMinimalState();
      state.appState.pendingDrops = [createDrop()];

      const result = await handleStartFarming(state, { game: createGame() });

      expect(result.success).toBe(true);
    });

    test('allows Start for a fresh zero-percent Twitch-native reward', async () => {
      const state = createMinimalState();
      const game = createGame({
        id: 'game-1',
        campaignId: 'campaign-1',
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      });
      const freshReward = createDrop({
        campaignId: game.campaignId,
        progress: 0,
        currentMinutes: 0,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      });
      state.appState.availableGames = [game];
      state.appState.pendingDrops = [freshReward];
      state.appState.currentDrop = freshReward;

      const result = await handleStartFarming(state, { game });

      expect(result).toEqual({ success: true });
      expect(state.appState.selectedGame).toBe(game);
    });
  });
}
