import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing13(): void {
  describe('subject.recomputeSelectedCampaignSummaryAfterLocalMarker', () => {
    test('updates only an already-known complete selected campaign with exact reward identity proof', () => {
      const selectedGame = {
        id: 'selected-game',
        name: 'Selected Game',
        imageUrl: '',
        campaignId: 'selected-campaign',
        dropCount: 1,
        rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
        allDropsCompleted: false,
      };
      const siblingGame = {
        id: 'selected-game',
        name: 'Selected Game',
        imageUrl: '',
        campaignId: 'sibling-campaign',
        dropCount: 1,
        rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
        allDropsCompleted: false,
      };
      const unverifiable = {
        id: 'badge',
        name: 'Badge',
        gameId: selectedGame.id,
        gameName: selectedGame.name,
        imageUrl: '',
        campaignId: selectedGame.campaignId,
        progress: 99,
        currentMinutes: 59,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-badge',
        verificationState: 'unverifiable',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame,
          availableGames: [selectedGame, siblingGame],
          queue: [selectedGame, siblingGame],
          allDrops: [unverifiable],
        },
      });

      expect(subject.recomputeSelectedCampaignSummaryAfterLocalMarker(state)).toBe(true);
      expect(state.appState.selectedGame?.rewardSummary).toEqual({
        completion: 'farming-complete',
        remainderReasons: ['unverifiable-twitch'],
      });
      expect(state.appState.availableGames[0]).toBe(state.appState.selectedGame);
      expect(state.appState.queue[0]).toBe(state.appState.selectedGame);
      expect(state.appState.availableGames[1]).toBe(siblingGame);
      expect(state.appState.queue[1]).toBe(siblingGame);
    });

    test('refuses recomputation when exact reward-count proof is missing', () => {
      const selectedGame = {
        id: 'selected-game',
        name: 'Selected Game',
        imageUrl: '',
        campaignId: 'selected-campaign',
        dropCount: 2,
        rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
        allDropsCompleted: false,
      };
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame,
          availableGames: [selectedGame],
          queue: [selectedGame],
          allDrops: [],
        },
      });

      expect(subject.recomputeSelectedCampaignSummaryAfterLocalMarker(state)).toBe(false);
      expect(state.appState.selectedGame).toBe(selectedGame);
      expect(state.appState.availableGames[0]).toBe(selectedGame);
      expect(state.appState.queue[0]).toBe(selectedGame);
    });
  });
}
