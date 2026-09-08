import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing03(): void {
  describe('unverifiable reward markers', () => {
    const nativeDrop = {
      id: 'reward-1',
      name: 'Twitch Badge',
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
    const nativeMarkerKey = '["campaign-1","reward-1"]';
    void nativeMarkerKey;

    test('clears all markers on an authoritative empty campaign snapshot', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);

      // When
      subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [], updatedAt: 11 },
        'campaign-authoritative',
      );

      // Then
      expect(state.unverifiableRewardsByKey).toEqual({});
    });
  });
}
