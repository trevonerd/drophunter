import { describe, expect, test } from 'bun:test';
import {
  markDropUnverifiable,
  reconcileUnverifiableRewardMarkers,
} from '../src/background/drops-projection-semantics.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

const staleObservation = {
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
} satisfies TwitchDrop;

const authoritativeCampaign = {
  id: 'game-1',
  name: 'Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  dropCount: 2,
} satisfies TwitchGame;

const observedRewardA = {
  ...staleObservation,
  id: 'reward-a',
  progress: 0,
  currentMinutes: 0,
} satisfies TwitchDrop;

const observedRewardB = { ...observedRewardA, id: 'reward-b' } satisfies TwitchDrop;
const staleMarkerKey = '["campaign-1","reward-1"]';

function projectDuplicateObservations(drops: TwitchDrop[]) {
  const state = createServiceWorkerState();
  markDropUnverifiable(state, staleObservation, 10);
  const projected = reconcileUnverifiableRewardMarkers(
    state,
    { games: [], drops, updatedAt: 11 },
    'inventory-partial',
  )
    .map((drop) => ({
      progress: drop.progress,
      currentMinutes: drop.currentMinutes,
      verificationState: drop.verificationState,
    }))
    .sort((left, right) => left.progress - right.progress);
  return { projected, markers: state.unverifiableRewardsByKey };
}

function reconcileAuthoritativeRows(drops: TwitchDrop[]) {
  const state = createServiceWorkerState();
  markDropUnverifiable(state, staleObservation, 10);
  reconcileUnverifiableRewardMarkers(
    state,
    { games: [authoritativeCampaign], drops, updatedAt: 11 },
    'campaign-authoritative',
  );
  return state.unverifiableRewardsByKey;
}

describe('duplicate unverifiable reward observations', () => {
  test.each([
    {
      evidence: 'forward progress',
      stronger: { ...staleObservation, progress: 100, currentMinutes: 60 },
      expectedStrongerState: 'unassessed',
    },
    {
      evidence: 'verified acquisition',
      stronger: {
        ...staleObservation,
        progress: 100,
        currentMinutes: 60,
        claimed: true,
        verificationState: 'verified',
      },
      expectedStrongerState: 'verified',
    },
  ] as const)('reconciles every same-key row when $evidence appears in either order', ({
    stronger,
    expectedStrongerState,
  }) => {
    // Given
    const expected = {
      projected: [
        { progress: 99, currentMinutes: 59, verificationState: 'unassessed' },
        { progress: 100, currentMinutes: 60, verificationState: expectedStrongerState },
      ],
      markers: {},
    };

    // When
    const staleThenStrong = projectDuplicateObservations([staleObservation, stronger]);
    const strongThenStale = projectDuplicateObservations([stronger, staleObservation]);

    // Then
    expect(staleThenStrong).toEqual(expected);
    expect(strongThenStale).toEqual(staleThenStrong);
  });
});

describe('authoritative reward-set completeness', () => {
  test('preserves an absent marker when duplicate rows only appear complete after deduplication', () => {
    // Given
    const malformedRows = [observedRewardA, observedRewardA, observedRewardB];

    // When
    const markers = reconcileAuthoritativeRows(malformedRows);

    // Then
    expect(markers).toEqual({
      [staleMarkerKey]: { progress: 99, currentMinutes: 59, markedAt: 10 },
    });
  });

  test('clears an absent marker when raw rows exactly match the declared unique rewards', () => {
    // Given
    const exactRows = [observedRewardA, observedRewardB];

    // When
    const markers = reconcileAuthoritativeRows(exactRows);

    // Then
    expect(markers).toEqual({});
  });
});
