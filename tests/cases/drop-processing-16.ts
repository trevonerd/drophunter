import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing16(): void {
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

    test('passes campaign-authoritative provenance for a successful campaign refresh', async () => {
      // Given
      const observed: subject.DropsSnapshotProvenance[] = [];
      const state = subject.makeState();

      // When
      await subject.refreshDropsData(
        state,
        { includeCampaignFetch: true, suppressNotifications: true },
        {
          onFetchDropsSnapshotFromApi: async () => ({
            games: [game],
            drops: [cachedDrop],
            campaignsVerified: true,
            authoritativeCampaignIds: ['campaign-1'],
            updatedAt: 1,
          }),
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        projectionDeps(observed),
      );

      // Then
      expect(observed).toEqual(['campaign-authoritative']);
    });

    test('passes inventory-partial provenance for a successful inventory refresh', async () => {
      // Given
      const observed: subject.DropsSnapshotProvenance[] = [];
      const state = subject.makeState({ cachedDropsSnapshot: [cachedDrop] });

      // When
      await subject.refreshDropsData(
        state,
        { includeInventoryFetch: true, suppressNotifications: true },
        {
          onFetchDropsSnapshotFromApi: async () => null,
          onFetchInventorySnapshotFromApi: async () => ({
            games: [],
            drops: [{ ...cachedDrop, progress: 1 }],
            updatedAt: 1,
          }),
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        projectionDeps(observed),
      );

      // Then
      expect(observed).toEqual(['inventory-partial']);
    });

    test('passes cached provenance after a failed campaign refresh', async () => {
      // Given
      const observed: subject.DropsSnapshotProvenance[] = [];
      const state = subject.makeState({ cachedDropsSnapshot: [cachedDrop] });

      // When
      await subject.refreshDropsData(
        state,
        { includeCampaignFetch: true, suppressNotifications: true },
        {
          onFetchDropsSnapshotFromApi: async () => null,
          onEvaluateDropTransitions: async () => undefined,
          onSaveState: async () => undefined,
        },
        projectionDeps(observed),
      );

      // Then
      expect(observed).toEqual(['cached']);
    });

    test('preserves stale projection for a verified campaign whose reward rows are absent', async () => {
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
            games: [{ ...game, dropCount: 0 }],
            drops: [],
            campaignsVerified: true,
            authoritativeCampaignIds: ['campaign-1'],
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
      expect(state.unverifiableRewardsByKey['["campaign-1","reward-1"]']).toBeDefined();
      expect(state.cachedDropsSnapshot.map((drop) => drop.id)).toEqual(['reward-1']);
      expect(state.appState.allDrops.map((drop) => drop.id)).toEqual(['reward-1']);
      expect(state.appState.currentDrop).toBeNull();
    });
  });
}
