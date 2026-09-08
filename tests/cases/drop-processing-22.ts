import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing22(): void {
  describe('subject.resetStateForAuthoritativeEmptyCampaignExt', () => {
    test('wipes volatile campaign state including unverifiable markers', () => {
      const game: subject.TwitchGame = { id: 'g1', name: 'G1' } as subject.TwitchGame;
      const drop = { id: 'd1' } as subject.TwitchDrop;
      const state = subject.makeState({
        appState: {
          ...subject.createInitialState(),
          availableGames: [game],
          queue: [game],
          selectedGame: game,
          currentDrop: drop,
          allDrops: [drop],
          pendingDrops: [drop],
          completedDrops: [drop],
          completionNotified: true,
          lastSuccessfulRefreshAt: 12345,
        },
        cachedDropsSnapshot: [drop],
        cachedCampaignChannelsMap: { 'campaign-1': ['streamer-a'] },
        previousAllDropsCount: 9,
        unverifiableRewardsByKey: {
          '["c1","d1"]': { progress: 99, currentMinutes: 59, markedAt: 10 },
        },
      });
      subject.resetStateForAuthoritativeEmptyCampaignExt(state);
      expect(state.appState.availableGames).toEqual([]);
      expect(state.appState.queue).toEqual([]);
      expect(state.appState.selectedGame).toBeNull();
      expect(state.appState.currentDrop).toBeNull();
      expect(state.appState.allDrops).toEqual([]);
      expect(state.appState.pendingDrops).toEqual([]);
      expect(state.appState.completedDrops).toEqual([]);
      expect(state.appState.completionNotified).toBe(false);
      expect(state.cachedDropsSnapshot).toEqual([]);
      expect(state.cachedCampaignChannelsMap).toEqual({});
      expect(state.previousAllDropsCount).toBe(0);
      expect(state.unverifiableRewardsByKey).toEqual({});
    });
  });
}
