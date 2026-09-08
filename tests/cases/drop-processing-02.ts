import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing02(): void {
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

    test('clears a marker on forward percentage evidence', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const progressed = { ...nativeDrop, progress: 100 };

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [progressed], updatedAt: 11 },
        'inventory-partial',
      );

      // Then
      expect(projected.verificationState).toBe('unassessed');
      expect(state.unverifiableRewardsByKey).toEqual({});
    });

    test('clears a marker on forward watched-minutes evidence', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const progressed = { ...nativeDrop, currentMinutes: 60 };

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [progressed], updatedAt: 11 },
        'inventory-partial',
      );

      // Then
      expect(projected.verificationState).toBe('unassessed');
      expect(state.unverifiableRewardsByKey).toEqual({});
    });

    test('clears a marker only on verified acquisition rather than claimed status alone', () => {
      // Given
      const claimedWithoutProof = { ...nativeDrop, claimed: true, progress: 100 };
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [claimedWithoutProof], updatedAt: 11 },
        'cached',
      );

      // Then
      expect(projected.verificationState).toBe('unverifiable');
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });

    test('clears a marker when strict verified acquisition arrives', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const verified = {
        ...nativeDrop,
        claimed: true,
        progress: 100,
        verificationState: 'verified' as const,
      };

      // When
      const [projected] = subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [verified], updatedAt: 11 },
        'inventory-partial',
      );

      // Then
      expect(projected.verificationState).toBe('verified');
      expect(state.unverifiableRewardsByKey).toEqual({});
    });

    test('clears a marker when the reward is expired', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const expired = { ...nativeDrop, endsAt: '2000-01-01T00:00:00.000Z' };

      // When
      subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [expired], updatedAt: 11 },
        'cached',
      );

      // Then
      expect(state.unverifiableRewardsByKey).toEqual({});
    });

    test('preserves disappearance on partial inventory data', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);

      // When
      subject.reconcileUnverifiableRewardMarkers(
        state,
        { games: [], drops: [], updatedAt: 11 },
        'inventory-partial',
      );

      // Then
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });

    test('clears a marker when an authoritative complete campaign omits the reward', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const replacement = { ...nativeDrop, id: 'reward-2', progress: 0, currentMinutes: 0 };

      // When
      subject.reconcileUnverifiableRewardMarkers(
        state,
        {
          games: [{ id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1', dropCount: 1 }],
          drops: [replacement],
          updatedAt: 11,
        },
        'campaign-authoritative',
      );

      // Then
      expect(state.unverifiableRewardsByKey).toEqual({});
    });

    test('preserves a missing reward when the authoritative campaign set is incomplete', () => {
      // Given
      const state = subject.makeState();
      subject.markDropUnverifiable(state, nativeDrop, 10);
      const replacement = { ...nativeDrop, id: 'reward-2', progress: 0, currentMinutes: 0 };

      // When
      subject.reconcileUnverifiableRewardMarkers(
        state,
        {
          games: [{ id: 'game-1', name: 'Game', imageUrl: '', campaignId: 'campaign-1', dropCount: 2 }],
          drops: [replacement],
          updatedAt: 11,
        },
        'campaign-authoritative',
      );

      // Then
      expect(state.unverifiableRewardsByKey[nativeMarkerKey]).toBeDefined();
    });
  });
}
