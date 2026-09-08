import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing21(): void {
  describe('subject.clearSelectedCompletedIdleCampaignExt', () => {
    const selectedGame: subject.TwitchGame = {
      id: 'game-1',
      name: 'Test Game',
      campaignId: 'campaign-1',
      categorySlug: 'test-game',
    } as subject.TwitchGame;

    const completedDrop = {
      id: 'drop-1',
      name: 'Completed Reward',
      gameId: 'game-1',
      gameName: 'Test Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      claimed: true,
      progress: 100,
      currentMinutes: 100,
      requiredMinutes: 100,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies subject.TwitchDrop;

    const farmablePendingDrop = {
      id: 'drop-2',
      name: 'Pending Reward',
      gameId: 'game-1',
      gameName: 'Test Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      claimed: false,
      progress: 50,
      currentMinutes: 50,
      requiredMinutes: 100,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies subject.TwitchDrop;

    const subscriptionDrop = {
      id: 'drop-3',
      name: 'Subscriber Reward',
      gameId: 'game-1',
      gameName: 'Test Game',
      imageUrl: '',
      campaignId: 'campaign-1',
      claimed: false,
      progress: 50,
      currentMinutes: 50,
      requiredMinutes: 100,
      acquisitionMethod: 'subscription',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    } satisfies subject.TwitchDrop;

    test('no-op when isRunning=true', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          isRunning: true,
          selectedGame,
          queue: [],
          allDrops: [completedDrop],
        },
        cachedDropsSnapshot: [completedDrop],
      });
      subject.clearSelectedCompletedIdleCampaignExt(state);
      expect(state.appState.selectedGame).toBe(selectedGame);
    });

    test('no-op when selectedGame is null', () => {
      const state = subject.makeState({ cachedDropsSnapshot: [completedDrop] });
      subject.clearSelectedCompletedIdleCampaignExt(state);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.allDrops).toEqual([]);
    });

    test('no-op when queue has items', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame,
          queue: [{ gameId: 'game-1' } as subject.TwitchGame],
          allDrops: [completedDrop],
        },
        cachedDropsSnapshot: [completedDrop],
      });
      subject.clearSelectedCompletedIdleCampaignExt(state);
      expect(state.appState.selectedGame).toBe(selectedGame);
      expect(state.appState.allDrops).toEqual([completedDrop]);
    });

    test('no-op when there is a farmable pending drop', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame,
          queue: [],
          allDrops: [farmablePendingDrop],
          pendingDrops: [farmablePendingDrop],
        },
        cachedDropsSnapshot: [farmablePendingDrop],
      });
      subject.clearSelectedCompletedIdleCampaignExt(state);
      expect(state.appState.selectedGame).toBe(selectedGame);
      expect(state.appState.allDrops).toEqual([farmablePendingDrop]);
    });

    test('wipes when only a subscription-gated reward remains', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame,
          queue: [],
          allDrops: [subscriptionDrop],
          pendingDrops: [subscriptionDrop],
        },
        cachedDropsSnapshot: [subscriptionDrop],
      });
      subject.clearSelectedCompletedIdleCampaignExt(state);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.allDrops).toEqual([]);
    });

    test('wipes selection and projections when only completed drops remain', () => {
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          selectedGame,
          queue: [],
          allDrops: [completedDrop],
          pendingDrops: [completedDrop],
          completedDrops: [completedDrop],
          currentDrop: completedDrop,
          completionNotified: true,
        },
        cachedDropsSnapshot: [completedDrop],
        previousAllDropsCount: 5,
      });
      subject.clearSelectedCompletedIdleCampaignExt(state);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.currentDrop).toBeNull();
      expect(state.appState.allDrops).toEqual([]);
      expect(state.appState.pendingDrops).toEqual([]);
      expect(state.appState.completedDrops).toEqual([]);
      expect(state.appState.completionNotified).toBe(false);
      expect(state.previousAllDropsCount).toBe(0);
    });
  });
}
