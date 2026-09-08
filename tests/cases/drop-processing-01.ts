import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing01(): void {
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

    test('preserves the exact observed baseline when marking a campaign reward', () => {
      // Given
      const state = subject.makeState();

      // When
      const marked = subject.markDropUnverifiable(state, nativeDrop, 123_456);

      // Then
      expect(marked).toBe(true);
      expect(state.unverifiableRewardsByKey).toEqual({
        [nativeMarkerKey]: { progress: 99, currentMinutes: 59, markedAt: 123_456 },
      });
      expect(subject.applyUnverifiableRewardMarker(state, nativeDrop)).toMatchObject({
        progress: 99,
        currentMinutes: 59,
        verificationState: 'unverifiable',
      });
    });

    test('isolates equal reward ids by campaign when applying and clearing a marker', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 123_456);
      const sibling = { ...nativeDrop, campaignId: 'campaign-2', progress: 0, currentMinutes: 0 };

      // When
      const siblingProjection = subject.applyUnverifiableRewardMarker(state, sibling);
      const clearedSibling = subject.clearUnverifiableRewardMarker(state, sibling);

      // Then
      expect(siblingProjection.verificationState).toBe('unassessed');
      expect(clearedSibling).toBe(false);
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });

    test('isolates delimiter-bearing reward and campaign identities', () => {
      // Given
      const state = subject.makeState();
      const first = { ...nativeDrop, id: 'a::b', campaignId: 'c' };
      const second = { ...nativeDrop, id: 'a', campaignId: 'b::c' };

      // When
      subject.markDropUnverifiable(state, first, 123_456);
      const firstProjection = subject.applyUnverifiableRewardMarker(state, first);
      const secondProjection = subject.applyUnverifiableRewardMarker(state, second);

      // Then
      expect(firstProjection.verificationState).toBe('unverifiable');
      expect(secondProjection.verificationState).toBe('unassessed');
      expect(Object.keys(state.unverifiableRewardsByKey)).toHaveLength(1);
    });

    test('never persists a marker when campaign identity is missing or blank', () => {
      // Given
      const state = subject.makeState();
      const missingCampaign = { ...nativeDrop, campaignId: undefined };
      const blankCampaign = { ...nativeDrop, campaignId: '   ' };

      // When
      const missingMarked = subject.markDropUnverifiable(state, missingCampaign, 1);
      const blankMarked = subject.markDropUnverifiable(state, blankCampaign, 2);

      // Then
      expect(missingMarked).toBe(false);
      expect(blankMarked).toBe(false);
      expect(state.unverifiableRewardsByKey).toEqual({});
      expect(subject.applyUnverifiableRewardMarker(state, missingCampaign).verificationState).toBe(
        'unassessed',
      );
    });

    test('preserves an exact zero-percent marker on equal inventory evidence', () => {
      // Given
      const state = subject.makeState();
      const zeroPercentDrop = { ...nativeDrop, progress: 0, currentMinutes: 0 };
      subject.markDropUnverifiable(state, zeroPercentDrop, 10);

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [zeroPercentDrop], updatedAt: 11 },
        'inventory-partial',
      );

      // Then
      expect(projected.progress).toBe(0);
      expect(projected.currentMinutes).toBe(0);
      expect(projected.verificationState).toBe('unverifiable');
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });

    test('preserves a marker on weaker campaign evidence', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const weaker = { ...nativeDrop, progress: 90, currentMinutes: 50 };

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        {
          games: [{ id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1', dropCount: 1 }],
          drops: [weaker],
          updatedAt: 11,
        },
        'campaign-authoritative',
      );

      // Then
      expect(projected.verificationState).toBe('unverifiable');
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });

    test('preserves a marker when only cached data is projected', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const cachedAhead = { ...nativeDrop, progress: 100, currentMinutes: 60 };

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [cachedAhead], updatedAt: 11 },
        'cached',
      );

      // Then
      expect(projected.verificationState).toBe('unverifiable');
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });
  });
}
