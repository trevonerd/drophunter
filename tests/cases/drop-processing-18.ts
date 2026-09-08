import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing18(): void {
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

    test('preserves markers and projected state when campaign refresh fails and cached state is used', async () => {
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
          onFetchDropsSnapshotFromApi: async () => null,
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
