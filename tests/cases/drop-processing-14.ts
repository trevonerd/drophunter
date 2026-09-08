import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing14(): void {
  describe('subject.projectDropsSnapshot', () => {
    test('handles empty snapshot', () => {
      const state = subject.makeState();
      const snapshot = { games: [], drops: [], updatedAt: Date.now() };
      subject.projectDropsSnapshot(state, snapshot, 'campaign-authoritative');
      expect(state.appState.availableGames).toEqual([]);
      expect(state.appState.allDrops).toEqual([]);
    });

    test('updates state with drops and games from snapshot', () => {
      const state = subject.makeState();
      const game = { id: 'g1', name: 'Destiny 2', imageUrl: '' };
      const drop = {
        id: 'd1',
        name: 'Drop A',
        gameId: 'g1',
        gameName: 'Destiny 2',
        imageUrl: '',
        progress: 50,
        currentMinutes: 30,
        claimed: false,
      } as subject.TwitchDrop;
      const snapshot = { games: [game], drops: [drop], updatedAt: Date.now() };

      subject.projectDropsSnapshot(state, snapshot, 'campaign-authoritative');

      expect(state.appState.availableGames).toHaveLength(1);
      expect(state.appState.availableGames[0].name).toBe('Destiny 2');
    });

    test('replaces availableGames when snapshot provides games', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          availableGames: [{ id: 'old', name: 'Old Game', imageUrl: '' }],
        },
      });
      const newGame = { id: 'new', name: 'New Game', imageUrl: '' };
      const snapshot = { games: [newGame], drops: [], updatedAt: Date.now() };

      subject.projectDropsSnapshot(state, snapshot, 'campaign-authoritative');

      expect(state.appState.availableGames).toHaveLength(1);
      expect(state.appState.availableGames[0].id).toBe('new');
    });

    test('reconciles a marker before selecting the current reward', () => {
      // Given
      const game = {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        dropCount: 1,
      } satisfies subject.TwitchGame;
      const drop = {
        id: 'reward-1',
        name: 'Badge',
        gameId: 'game-1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        progress: 99,
        currentMinutes: 59,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({
        appState: { ...subject.createInitialState(), selectedGame: game, availableGames: [game] },
      });
      subject.markDropUnverifiable(state, drop, 10);

      // When
      subject.projectDropsSnapshot(
        state,
        { games: [game], drops: [drop], updatedAt: 11 },
        'campaign-authoritative',
      );

      // Then
      expect(state.appState.currentDrop).toBeNull();
      expect(state.appState.pendingDrops[0]?.verificationState).toBe('unverifiable');
      expect(state.appState.availableGames[0]?.rewardSummary).toEqual({
        completion: 'farming-complete',
        remainderReasons: ['unverifiable-twitch'],
      });
    });

    test('keeps a Twitch-native reward without campaign identity on the ordinary path', () => {
      // Given
      const game = { id: 'game-1', name: 'Game', imageUrl: '' } satisfies subject.TwitchGame;
      const drop = {
        id: 'reward-1',
        name: 'Badge',
        gameId: 'game-1',
        gameName: 'Game',
        imageUrl: '',
        progress: 0,
        currentMinutes: 0,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({ appState: { ...subject.createInitialState(), selectedGame: game } });

      // When
      subject.projectDropsSnapshot(state, { games: [game], drops: [drop], updatedAt: 11 }, 'cached');

      // Then
      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(state.appState.currentDrop?.id).toBe('reward-1');
      expect(state.appState.currentDrop?.verificationState).toBe('unassessed');
    });

    test.each([
      'inventory-partial',
      'cached',
    ] as const)('preserves an authoritative campaign summary through a %s projection', (provenance) => {
      // Given
      const summary = {
        completion: 'farming-complete' as const,
        remainderReasons: ['unverifiable-twitch' as const],
      };
      const previousGame = {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        dropCount: 1,
        rewardSummary: summary,
        allDropsCompleted: false,
      } satisfies subject.TwitchGame;
      const rawGame = {
        id: 'game-1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'campaign-1',
        dropCount: 1,
      } satisfies subject.TwitchGame;
      const state = subject.makeState({
        appState: { ...subject.createInitialState(), availableGames: [previousGame] },
      });

      // When
      subject.projectDropsSnapshot(state, { games: [rawGame], drops: [], updatedAt: 11 }, provenance);

      // Then
      expect(state.appState.availableGames[0]?.rewardSummary).toEqual(summary);
      expect(state.appState.availableGames[0]?.allDropsCompleted).toBe(false);
    });
  });
}
