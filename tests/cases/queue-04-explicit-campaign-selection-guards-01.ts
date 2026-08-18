import { describe, expect, test } from 'bun:test';
import { handleSetSelectedGame } from '../../src/background/drops-tick.ts';
import { removeGameFromQueue, resolveGameFromState } from '../../src/background/queue-operations.ts';
import { handleStartFarming } from '../../src/background/session-lifecycle.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue04Part01() {
  describe('explicit campaign selection guards', () => {
    test('rejects START for an unavailable campaign before mutating queue or session state', async () => {
      const state = createMinimalState();
      const existingGame = createGame({ id: 'existing-game', campaignId: 'campaign-existing' });
      const requestedCampaign = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-missing',
      });
      const siblingCampaign = createGame({
        id: 'canonical-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-sibling',
      });
      state.appState.availableGames = [siblingCampaign];
      state.appState.queue = [existingGame];
      state.appState.selectedGame = existingGame;
      state.appState.isPaused = true;
      const queueBefore = [...state.appState.queue];
      let ensureCalls = 0;
      let refreshCalls = 0;

      const result = await handleStartFarming(
        state,
        { game: requestedCampaign },
        {
          onEnsureWorkspace: async () => {
            ensureCalls += 1;
          },
          onRefreshDropsData: async () => {
            refreshCalls += 1;
          },
        },
      );

      expect(result).toEqual({ success: false, error: 'Campaign is no longer available.' });
      expect(state.appState.queue).toEqual(queueBefore);
      expect(state.appState.selectedGame).toBe(existingGame);
      expect(state.appState.isRunning).toBe(false);
      expect(state.appState.isPaused).toBe(true);
      expect(ensureCalls).toBe(0);
      expect(refreshCalls).toBe(0);
    });

    test('starts an exact available campaign and preserves legacy no-campaign fallback', async () => {
      const exactState = createMinimalState();
      const exactGame = createGame({ id: 'exact-game', name: 'Exact Game', campaignId: 'campaign-exact' });
      exactState.appState.availableGames = [exactGame];
      exactState.appState.pendingDrops = [
        createDrop({ gameId: exactGame.id, gameName: exactGame.name, campaignId: exactGame.campaignId }),
      ];

      const exactResult = await handleStartFarming(exactState, { game: { ...exactGame } });

      expect(exactResult.success).toBe(true);
      expect(exactState.appState.selectedGame).toBe(exactGame);
      expect(exactState.appState.queue[0]).toBe(exactGame);

      const legacyState = createMinimalState();
      const legacyCanonical = createGame({
        id: 'legacy-canonical',
        name: 'Legacy Game',
        campaignId: 'campaign-legacy',
      });
      legacyState.appState.availableGames = [legacyCanonical];
      legacyState.appState.pendingDrops = [
        createDrop({
          gameId: legacyCanonical.id,
          gameName: legacyCanonical.name,
          campaignId: legacyCanonical.campaignId,
        }),
      ];

      const legacyResult = await handleStartFarming(legacyState, {
        game: createGame({ id: 'legacy-stale-id', name: legacyCanonical.name }),
      });

      expect(legacyResult.success).toBe(true);
      expect(legacyState.appState.selectedGame).toBe(legacyCanonical);
      expect(legacyState.appState.queue[0]).toBe(legacyCanonical);
    });

    test('rejects SET_SELECTED_GAME for an unavailable campaign without changing selection or queue', async () => {
      const state = createMinimalState();
      const existingGame = createGame({ id: 'existing-game', campaignId: 'campaign-existing' });
      const requestedCampaign = createGame({
        id: 'shared-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-missing',
      });
      const siblingCampaign = createGame({
        id: 'canonical-game-id',
        name: 'Shared Game',
        campaignId: 'campaign-sibling',
      });
      state.appState.availableGames = [siblingCampaign];
      state.appState.queue = [existingGame];
      state.appState.selectedGame = existingGame;
      const queueBefore = [...state.appState.queue];
      let refreshCalls = 0;
      let saveCalls = 0;

      const result = await handleSetSelectedGame(
        state,
        { game: requestedCampaign },
        {
          onTrackActivity: async () => undefined,
          onEnsureWorkspace: async () => undefined,
          onRefreshDropsData: async () => {
            refreshCalls += 1;
          },
          onOpenBestStreamer: async () => true,
          onSaveState: async () => {
            saveCalls += 1;
          },
          onSaveTimingState: async () => undefined,
        },
        {
          resolveGameFromState,
          removeGameFromQueue,
          splitDropsForSelectedGame: () => undefined,
          getGameDisplayLabel: (game) => game.name,
          logDebug: () => undefined,
          logWarn: () => undefined,
        },
      );

      expect(result).toEqual({ success: false, error: 'Campaign is no longer available.' });
      expect(state.appState.selectedGame).toBe(existingGame);
      expect(state.appState.queue).toEqual(queueBefore);
      expect(refreshCalls).toBe(0);
      expect(saveCalls).toBe(0);
    });

    test('selects an exact campaign from the queue when availability is temporarily stale', async () => {
      const state = createMinimalState();
      const queuedCampaign = createGame({
        id: 'queued-game',
        name: 'Queued Game',
        campaignId: 'campaign-queued',
      });
      state.appState.queue = [queuedCampaign];

      const result = await handleSetSelectedGame(
        state,
        { game: { ...queuedCampaign } },
        {
          onTrackActivity: async () => undefined,
          onEnsureWorkspace: async () => undefined,
          onRefreshDropsData: async () => undefined,
          onOpenBestStreamer: async () => true,
          onSaveState: async () => undefined,
          onSaveTimingState: async () => undefined,
        },
        {
          resolveGameFromState,
          removeGameFromQueue,
          splitDropsForSelectedGame: () => undefined,
          getGameDisplayLabel: (game) => game.name,
          logDebug: () => undefined,
          logWarn: () => undefined,
        },
      );

      expect(result.success).toBe(true);
      expect(state.appState.selectedGame).toBe(queuedCampaign);
    });
  });
}
