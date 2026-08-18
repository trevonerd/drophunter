import { describe, expect, test } from 'bun:test';
import { projectDropsSnapshot, splitDropsForSelectedGame } from '../../src/background/drops-projection.ts';
import { refreshDropsData } from '../../src/background/drops-tick.ts';
import { normalizeQueueSelection } from '../../src/background/queue-operations.ts';
import { replaceAvailableGames } from '../../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue22Part01() {
  describe('refreshDropsData light refresh', () => {
    test('updates inventory progress without calling the full campaign fetch', async () => {
      const state = createMinimalState();
      const forHonor = createGame({
        id: 'campaign-for-honor',
        name: 'For Honor',
        campaignId: 'campaign-for-honor',
        categorySlug: 'for-honor',
      });
      const overwatch = createGame({
        id: 'campaign-overwatch',
        name: 'Overwatch',
        campaignId: 'campaign-overwatch',
        categorySlug: 'overwatch',
      });
      const forHonorDrop = createDrop({
        id: 'drop-for-honor',
        gameId: forHonor.id,
        gameName: forHonor.name,
        campaignId: forHonor.campaignId,
        currentMinutes: 120,
        requiredMinutes: 240,
        remainingMinutes: 120,
        progress: 50,
      });
      const overwatchDrop = createDrop({
        id: 'drop-overwatch',
        gameId: overwatch.id,
        gameName: overwatch.name,
        campaignId: overwatch.campaignId,
        currentMinutes: 327,
        requiredMinutes: 720,
        remainingMinutes: 393,
        progress: 45,
      });

      state.appState.isRunning = true;
      state.appState.selectedGame = forHonor;
      state.appState.availableGames = [forHonor, overwatch];
      state.appState.queue = [forHonor, overwatch];
      state.cachedDropsSnapshot = [forHonorDrop, overwatchDrop];
      splitDropsForSelectedGame(state, state.cachedDropsSnapshot);

      let fullFetchCalled = false;
      let inventoryFetchCalled = false;

      await refreshDropsData(
        state,
        { includeInventoryFetch: true },
        {
          onFetchDropsSnapshotFromApi: async () => {
            fullFetchCalled = true;
            return null;
          },
          onFetchInventorySnapshotFromApi: async (baseDrops) => {
            inventoryFetchCalled = true;
            return {
              games: [],
              drops: baseDrops.map((drop) =>
                drop.campaignId === forHonor.campaignId
                  ? { ...drop, currentMinutes: 180, progress: 75, remainingMinutes: 60 }
                  : drop,
              ),
              updatedAt: Date.now(),
            };
          },
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        {
          replaceAvailableGames,
          getGameDisplayLabel: (game) => game.displayName ?? game.name,
          projectDropsSnapshot,
          normalizeQueueSelection,
        },
      );

      expect(fullFetchCalled).toBe(false);
      expect(inventoryFetchCalled).toBe(true);
      expect(state.appState.selectedGame?.campaignId).toBe(forHonor.campaignId);
      expect(state.appState.currentDrop?.campaignId).toBe(forHonor.campaignId);
      expect(state.appState.currentDrop?.currentMinutes).toBe(180);
      expect(state.appState.queue.map((game) => game.campaignId)).toEqual([
        forHonor.campaignId,
        overwatch.campaignId,
      ]);
    });

    test('preserves cached cross-game drops when inventory-only refresh has no data', async () => {
      const state = createMinimalState();
      const forHonor = createGame({
        id: 'campaign-for-honor',
        name: 'For Honor',
        campaignId: 'campaign-for-honor',
        categorySlug: 'for-honor',
      });
      const overwatch = createGame({
        id: 'campaign-overwatch',
        name: 'Overwatch',
        campaignId: 'campaign-overwatch',
        categorySlug: 'overwatch',
      });
      const forHonorDrop = createDrop({
        id: 'drop-for-honor',
        gameId: forHonor.id,
        gameName: forHonor.name,
        campaignId: forHonor.campaignId,
        currentMinutes: 120,
        requiredMinutes: 240,
        remainingMinutes: 120,
        progress: 50,
      });
      const overwatchDrop = createDrop({
        id: 'drop-overwatch',
        gameId: overwatch.id,
        gameName: overwatch.name,
        campaignId: overwatch.campaignId,
        claimId: 'claim-overwatch',
        claimable: true,
        currentMinutes: 60,
        requiredMinutes: 60,
        remainingMinutes: 0,
        progress: 100,
      });

      state.appState.isRunning = true;
      state.appState.selectedGame = forHonor;
      state.appState.availableGames = [forHonor, overwatch];
      state.appState.queue = [forHonor, overwatch];
      state.cachedDropsSnapshot = [forHonorDrop, overwatchDrop];
      splitDropsForSelectedGame(state, state.cachedDropsSnapshot);

      await refreshDropsData(
        state,
        { includeInventoryFetch: true },
        {
          onFetchDropsSnapshotFromApi: async () => null,
          onFetchInventorySnapshotFromApi: async () => null,
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        {
          replaceAvailableGames,
          getGameDisplayLabel: (game) => game.displayName ?? game.name,
          projectDropsSnapshot,
          normalizeQueueSelection,
        },
      );

      expect(state.appState.selectedGame?.campaignId).toBe(forHonor.campaignId);
      expect(state.appState.currentDrop?.campaignId).toBe(forHonor.campaignId);
      expect(state.cachedDropsSnapshot.map((drop) => drop.id)).toEqual(['drop-for-honor', 'drop-overwatch']);
      expect(state.cachedDropsSnapshot.find((drop) => drop.id === 'drop-overwatch')?.claimable).toBe(true);
    });
  });
}
