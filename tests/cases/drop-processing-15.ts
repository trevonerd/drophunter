import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing15(): void {
  describe('subject.projectDropsSnapshot', () => {
    test('preserves a trusted summary through a count-incomplete authoritative replacement', () => {
      // Given
      const rewardSummary = { completion: 'all-acquired' as const, remainderReasons: [] };
      const previousGame = {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        dropCount: 2,
        rewardSummary,
        allDropsCompleted: true,
      } satisfies subject.TwitchGame;
      const incomingGame = {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        dropCount: 2,
      } satisfies subject.TwitchGame;
      const oneKnownReward = {
        id: 'reward-1',
        name: 'Reward',
        gameId: 'game-1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        progress: 50,
        currentMinutes: 30,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({
        appState: { ...subject.createInitialState(), availableGames: [previousGame] },
      });

      // When
      subject.projectDropsSnapshot(
        state,
        { games: [incomingGame], drops: [oneKnownReward], updatedAt: 11 },
        'campaign-authoritative',
      );

      // Then
      expect(state.appState.availableGames[0]?.rewardSummary).toEqual(rewardSummary);
      expect(state.appState.availableGames[0]?.allDropsCompleted).toBe(true);
    });

    test('rejects a blank reward id from authoritative completeness proof', () => {
      // Given
      const game = {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        dropCount: 0,
      } satisfies subject.TwitchGame;
      const malformedAcquiredReward = {
        id: '   ',
        name: 'Malformed Reward',
        gameId: 'game-1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        progress: 100,
        currentMinutes: 60,
        claimed: true,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState();

      // When
      subject.projectDropsSnapshot(
        state,
        { games: [game], drops: [malformedAcquiredReward], updatedAt: 11 },
        'campaign-authoritative',
      );

      // Then
      expect(state.appState.availableGames[0]?.rewardSummary).toBeUndefined();
      expect(state.appState.availableGames[0]?.allDropsCompleted).toBeUndefined();
    });
  });
}
