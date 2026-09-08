import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing12(): void {
  describe('subject.annotateGameCompletion', () => {
    test('orders both farming-complete remainder reasons deterministically', () => {
      const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 2 };
      const subscription = {
        id: 'd1',
        name: 'Sub reward',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        progress: 0,
        currentMinutes: 0,
        claimed: false,
        acquisitionMethod: 'subscription',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;
      const unverifiable = {
        id: 'd2',
        name: 'Emote',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        progress: 0,
        currentMinutes: 0,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-emote',
        verificationState: 'unverifiable',
      } satisfies subject.TwitchDrop;

      const [result] = subject.annotateGameCompletion(
        [game],
        [subscription, unverifiable],
        'campaign-authoritative',
      );

      expect(result.rewardSummary).toEqual({
        completion: 'farming-complete',
        remainderReasons: ['subscription-required', 'unverifiable-twitch'],
      });
      expect(result.allDropsCompleted).toBe(false);
    });

    test('preserves a prior summary for partial inventory and cached projections', () => {
      const summary = { completion: 'all-acquired' as const, remainderReasons: [] };
      const game = {
        id: 'g1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        dropCount: 1,
        rewardSummary: summary,
        allDropsCompleted: true,
      };
      const partial = {
        id: 'd1',
        name: 'Reward',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        progress: 0,
        currentMinutes: 0,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'in-game',
        verificationState: 'unassessed',
      } satisfies subject.TwitchDrop;

      const [inventoryResult] = subject.annotateGameCompletion([game], [partial], 'inventory-partial');
      const [cachedResult] = subject.annotateGameCompletion([game], [partial], 'cached');

      expect(inventoryResult).toBe(game);
      expect(cachedResult).toBe(game);
    });
  });
}
