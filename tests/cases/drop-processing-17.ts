import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing17(): void {
  describe('subject.refreshDropsData projection provenance', () => {
    const cachedDrop = {
      id: 'reward-1',
      name: 'Reward',
      gameId: 'game-1',
      gameName: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies subject.TwitchDrop;
    const game = {
      id: 'game-1',
      name: 'Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      dropCount: 1,
    } satisfies subject.TwitchGame;

    function projectionDeps(observed: subject.DropsSnapshotProvenance[]) {
      return {
        replaceAvailableGames: (games: subject.TwitchGame[]) => games,
        getGameDisplayLabel: (candidate: subject.TwitchGame) => candidate.name,
        projectDropsSnapshot: (
          _state: subject.ServiceWorkerState,
          _snapshot: { games: subject.TwitchGame[]; drops: subject.TwitchDrop[]; updatedAt: number },
          provenance: subject.DropsSnapshotProvenance,
        ) => observed.push(provenance),
        normalizeQueueSelection: () => undefined,
      };
    }
    void projectionDeps;

    test('clears markers and stale projected games when campaign refresh returns no games or drops', async () => {
      // Given
      const staleDrop = {
        ...cachedDrop,
        name: 'Badge',
        progress: 99,
        currentMinutes: 59,
        rewardKind: 'twitch-badge',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
          availableGames: [game],
          allDrops: [staleDrop],
          pendingDrops: [staleDrop],
          currentDrop: staleDrop,
        },
        cachedDropsSnapshot: [staleDrop],
      });
      subject.markDropUnverifiable(state, staleDrop, 10);

      // When
      await subject.refreshDropsData(
        state,
        { includeCampaignFetch: true, suppressNotifications: true },
        {
          onFetchDropsSnapshotFromApi: async () => ({
            games: [],
            drops: [],
            campaignsVerified: true,
            authoritativeCampaignIds: [],
            updatedAt: 2,
          }),
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        {
          replaceAvailableGames: (games) => games,
          getGameDisplayLabel: (candidate) => candidate.name,
          projectDropsSnapshot: subject.projectDropsSnapshot,
          normalizeQueueSelection: () => undefined,
        },
      );

      // Then
      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(state.appState.availableGames).toEqual([]);
      expect(state.appState.allDrops).toEqual([]);
      expect(state.appState.pendingDrops).toEqual([]);
      expect(state.appState.currentDrop).toBeNull();
    });

    test('preserves markers and projected state when inventory refresh returns an empty partial snapshot', async () => {
      // Given
      const staleDrop = {
        ...cachedDrop,
        name: 'Badge',
        progress: 99,
        currentMinutes: 59,
        rewardKind: 'twitch-badge',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
          availableGames: [game],
          allDrops: [staleDrop],
          pendingDrops: [staleDrop],
          currentDrop: staleDrop,
        },
        cachedDropsSnapshot: [staleDrop],
      });
      subject.markDropUnverifiable(state, staleDrop, 10);

      // When
      await subject.refreshDropsData(
        state,
        { includeInventoryFetch: true, suppressNotifications: true },
        {
          onFetchDropsSnapshotFromApi: async () => null,
          onFetchInventorySnapshotFromApi: async () => ({ games: [], drops: [], updatedAt: 2 }),
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        {
          replaceAvailableGames: (games) => games,
          getGameDisplayLabel: (candidate) => candidate.name,
          projectDropsSnapshot: subject.projectDropsSnapshot,
          normalizeQueueSelection: () => undefined,
        },
      );

      // Then
      expect(state.unverifiableRewardsByKey['["campaign-1","reward-1"]']).toBeDefined();
      expect(state.appState.availableGames.map((candidate) => candidate.id)).toEqual(['game-1']);
      expect(state.appState.allDrops.map((drop) => drop.id)).toEqual(['reward-1']);
    });
  });
}
