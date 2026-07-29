import { expect, test } from 'bun:test';
import { isDropCompleted, mergeDropProgressMonotonic } from '../src/shared/drops.ts';
import type { TwitchDrop } from '../src/types/index.ts';

function createDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

test('keeps stronger progress when a refresh is weaker', () => {
  // Given
  const previousDrop = createDrop({ progress: 60, currentMinutes: 60 });
  const refreshedDrop = createDrop({ progress: 25, currentMinutes: 25 });

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop.progress).toBe(60);
});

test('keeps a prior claim when a refresh loses claimed state', () => {
  // Given
  const previousDrop = createDrop({
    progress: 100,
    claimed: true,
    claimable: false,
    remainingMinutes: 0,
  });
  const refreshedDrop = createDrop({
    progress: 20,
    claimed: false,
    claimable: true,
    remainingMinutes: 80,
  });

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop).toMatchObject({
    progress: 100,
    claimed: true,
    claimable: false,
    remainingMinutes: 0,
    status: 'completed',
  });
});

test('keeps known reward classification when a refresh reports unknown values', () => {
  // Given
  const previousDrop = {
    ...createDrop(),
    acquisitionMethod: 'watch-time' as const,
    rewardKind: 'twitch-badge' as const,
  };
  const refreshedDrop = {
    ...createDrop(),
    acquisitionMethod: 'unknown' as const,
    rewardKind: 'unknown' as const,
  };

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop).toMatchObject({
    acquisitionMethod: 'watch-time',
    rewardKind: 'twitch-badge',
  });
});

test('keeps prior subscription and emote classification when a refresh reports unknown values', () => {
  // Given
  const previousDrop = createDrop({
    acquisitionMethod: 'subscription',
    rewardKind: 'twitch-emote',
  });
  const refreshedDrop = createDrop({
    acquisitionMethod: 'unknown',
    rewardKind: 'unknown',
  });

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop).toMatchObject({
    acquisitionMethod: 'subscription',
    rewardKind: 'twitch-emote',
  });
});

test('uses a fresh known reward classification instead of a prior classification', () => {
  // Given
  const previousDrop = {
    ...createDrop(),
    acquisitionMethod: 'subscription' as const,
    rewardKind: 'in-game' as const,
  };
  const refreshedDrop = {
    ...createDrop(),
    acquisitionMethod: 'watch-time' as const,
    rewardKind: 'twitch-emote' as const,
  };

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop).toMatchObject({
    acquisitionMethod: 'watch-time',
    rewardKind: 'twitch-emote',
  });
});

test('keeps verified acquisition with monotonic claimed progress', () => {
  // Given
  const previousDrop = {
    ...createDrop({ progress: 100, claimed: true }),
    verificationState: 'verified' as const,
  };
  const refreshedDrop = {
    ...createDrop({ progress: 0, claimed: false }),
    verificationState: 'unassessed' as const,
  };

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop).toMatchObject({
    progress: 100,
    claimed: true,
    verificationState: 'verified',
  });
});

test('does not retain unverifiable state across a fresh unassessed refresh', () => {
  // Given
  const previousDrop = {
    ...createDrop({ progress: 45 }),
    verificationState: 'unverifiable' as const,
  };
  const refreshedDrop = {
    ...createDrop({ progress: 45 }),
    verificationState: 'unassessed' as const,
  };

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop.verificationState).toBe('unassessed');
});

test('uses the fresh required unassessed verification state', () => {
  // Given
  const previousDrop = createDrop({ progress: 45, verificationState: 'unverifiable' });
  const refreshedDrop = createDrop({ progress: 45 });

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop.verificationState).toBe('unassessed');
});

test('does not turn an unverifiable reward into a completed reward', () => {
  // Given
  const previousDrop = createDrop({ progress: 40 });
  const refreshedDrop = {
    ...createDrop({ progress: 40, claimed: false }),
    verificationState: 'unverifiable' as const,
  };

  // When
  const mergedDrop = mergeDropProgressMonotonic(refreshedDrop, previousDrop);

  // Then
  expect(mergedDrop).toMatchObject({
    progress: 40,
    claimed: false,
    status: 'active',
    verificationState: 'unverifiable',
  });
  expect(isDropCompleted(mergedDrop)).toBe(false);
});
