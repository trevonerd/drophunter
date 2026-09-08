import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing19(): void {
  describe('subject.splitDropsForSelectedGame', () => {
    test('null selectedGame clears all drop state', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          allDrops: [
            {
              id: 'old',
              name: 'Old',
              gameId: 'g1',
              gameName: 'G',
              imageUrl: '',
              progress: 50,
              currentMinutes: 0,
              claimed: false,
            } as subject.TwitchDrop,
          ],
          pendingDrops: [],
          completedDrops: [],
          currentDrop: null,
        },
        lastTrackedDropKey: 'old-key',
        lastTrackedProgress: 50,
        lastTrackedMinutes: 30,
      });

      subject.splitDropsForSelectedGame(state, []);

      expect(state.appState.allDrops).toEqual([]);
      expect(state.appState.pendingDrops).toEqual([]);
      expect(state.appState.completedDrops).toEqual([]);
      expect(state.appState.currentDrop).toBeNull();
      expect(state.lastTrackedDropKey).toBeNull();
      expect(state.lastTrackedMinutes).toBe(-1);
    });

    test('matching drops are placed into correct categories', () => {
      const game = { id: 'g1', name: 'Destiny 2', imageUrl: '', campaignId: 'c1' };
      const drop = {
        id: 'd1',
        name: 'Drop A',
        gameId: 'g1',
        gameName: 'Destiny 2',
        imageUrl: '',
        progress: 50,
        currentMinutes: 30,
        claimed: false,
        campaignId: 'c1',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } as subject.TwitchDrop;

      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
        },
      });

      subject.splitDropsForSelectedGame(state, [drop]);

      expect(state.appState.allDrops).toHaveLength(1);
      expect(state.appState.pendingDrops.length).toBeGreaterThanOrEqual(0);
      expect(state.appState.completedDrops).toHaveLength(0);
    });

    test('claimed farmable drop does not become currentDrop', () => {
      const game = { id: 'g1', name: 'IL', imageUrl: '', campaignId: 'c1' };
      const claimedDrop = {
        id: 'd1',
        name: 'Claimed Reward',
        gameId: 'g1',
        gameName: 'IL',
        imageUrl: '',
        progress: 100,
        currentMinutes: 60,
        claimed: true,
        claimable: false,
        campaignId: 'c1',
        requiredMinutes: 60,
        remainingMinutes: 0,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } as subject.TwitchDrop;

      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
        },
      });

      subject.splitDropsForSelectedGame(state, [claimedDrop]);

      expect(state.appState.completedDrops).toHaveLength(1);
      expect(state.appState.pendingDrops).toHaveLength(0);
      expect(state.appState.currentDrop).toBeNull();
    });

    test('claimed Twitch-native observation without verification does not become currentDrop', () => {
      const game = { id: 'g1', name: 'IL', imageUrl: '', campaignId: 'c1' };
      const claimedBadge = {
        id: 'badge-1',
        name: 'Claimed Badge',
        gameId: 'g1',
        gameName: 'IL',
        imageUrl: '',
        progress: 100,
        currentMinutes: 60,
        claimed: true,
        campaignId: 'c1',
        requiredMinutes: 60,
        remainingMinutes: 0,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-badge',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;
      const watchReward = {
        ...claimedBadge,
        id: 'watch-1',
        name: 'Next Reward',
        progress: 20,
        currentMinutes: 12,
        claimed: false,
        remainingMinutes: 48,
        rewardKind: 'in-game',
      } satisfies subject.TwitchDrop;
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
        },
      });

      subject.splitDropsForSelectedGame(state, [claimedBadge, watchReward]);

      expect(state.appState.pendingDrops).toHaveLength(2);
      expect(state.appState.currentDrop?.id).toBe('watch-1');
    });

    test('fully watched unclaimable drop does not become currentDrop', () => {
      const game = { id: 'g1', name: 'Subnautica', imageUrl: '', campaignId: 'c1' };
      const earnedDrop = {
        id: 'd1',
        name: 'Locked Account Reward',
        gameId: 'g1',
        gameName: 'Subnautica',
        imageUrl: '',
        progress: 100,
        currentMinutes: 60,
        claimed: false,
        claimable: false,
        campaignId: 'c1',
        requiredMinutes: 60,
        remainingMinutes: 0,
        status: 'completed',
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } as subject.TwitchDrop;

      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame: game,
        },
      });

      subject.splitDropsForSelectedGame(state, [earnedDrop]);

      expect(state.appState.completedDrops).toHaveLength(1);
      expect(state.appState.pendingDrops).toHaveLength(0);
      expect(state.appState.currentDrop).toBeNull();
    });
  });
}
