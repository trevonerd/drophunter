import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing11(): void {
  describe('subject.annotateGameCompletion', () => {
    test('sets allDropsCompleted=true when all matching drops are completed', () => {
      const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 2 };
      const drops = [
        {
          id: 'd1',
          gameId: 'g1',
          progress: 100,
          currentMinutes: 1,
          claimed: true,
          gameName: 'Game',
          imageUrl: '',
          campaignId: 'c1',
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        } satisfies subject.TwitchDrop,
        {
          id: 'd2',
          gameId: 'g1',
          progress: 100,
          currentMinutes: 1,
          claimed: true,
          gameName: 'Game',
          imageUrl: '',
          campaignId: 'c1',
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        } satisfies subject.TwitchDrop,
      ];
      const result = subject.annotateGameCompletion([game], drops, 'campaign-authoritative');
      expect(result[0].allDropsCompleted).toBe(true);
      expect(result[0].rewardSummary).toEqual({ completion: 'all-acquired', remainderReasons: [] });
    });

    test('keeps established campaign completion when matching drop progress regresses', () => {
      const game = {
        id: 'g1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        dropCount: 2,
        allDropsCompleted: true,
      };
      const drops = [
        {
          id: 'd1',
          gameId: 'g1',
          progress: 100,
          currentMinutes: 1,
          claimed: true,
          gameName: 'Game',
          imageUrl: '',
          campaignId: 'c1',
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        } satisfies subject.TwitchDrop,
        {
          id: 'd2',
          gameId: 'g1',
          progress: 50,
          currentMinutes: 1,
          claimed: false,
          gameName: 'Game',
          imageUrl: '',
          campaignId: 'c1',
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        } satisfies subject.TwitchDrop,
      ];
      const result = subject.annotateGameCompletion([game], drops, 'campaign-authoritative');
      expect(result[0].allDropsCompleted).toBe(true);
    });

    test('leaves the prior summary unchanged when expected reward count is not met', () => {
      const game = {
        id: 'g1',
        name: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        dropCount: 1,
        rewardSummary: { completion: 'farmable' as const, remainderReasons: [] },
      };
      const drops = [
        {
          id: 'd1',
          gameId: 'g2',
          progress: 50,
          currentMinutes: 1,
          claimed: false,
          gameName: 'Other',
          imageUrl: '',
          campaignId: 'c2',
          acquisitionMethod: 'watch-time',
          rewardKind: 'in-game',
          verificationState: 'unassessed',
        } satisfies subject.TwitchDrop,
      ];
      const result = subject.annotateGameCompletion([game], drops, 'campaign-authoritative');
      expect(result[0]).toBe(game);
    });

    test('derives subscription-only farming completion from a complete campaign set', () => {
      const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 1 };
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

      const [result] = subject.annotateGameCompletion([game], [subscription], 'campaign-authoritative');

      expect(result.rewardSummary).toEqual({
        completion: 'farming-complete',
        remainderReasons: ['subscription-required'],
      });
      expect(result.allDropsCompleted).toBe(false);
    });

    test('derives unverifiable-only farming completion from a complete campaign set', () => {
      const game = { id: 'g1', name: 'Game', imageUrl: '', campaignId: 'c1', dropCount: 1 };
      const unverifiable = {
        id: 'd1',
        name: 'Badge',
        gameId: 'g1',
        gameName: 'Game',
        imageUrl: '',
        campaignId: 'c1',
        progress: 99,
        currentMinutes: 59,
        claimed: false,
        acquisitionMethod: 'watch-time',
        rewardKind: 'twitch-badge',
        verificationState: 'unverifiable',
      } satisfies subject.TwitchDrop;

      const [result] = subject.annotateGameCompletion([game], [unverifiable], 'campaign-authoritative');

      expect(result.rewardSummary).toEqual({
        completion: 'farming-complete',
        remainderReasons: ['unverifiable-twitch'],
      });
      expect(result.allDropsCompleted).toBe(false);
    });
  });
}
