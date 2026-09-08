import { describe, expect, test } from 'bun:test';
import { pickNearestDrop } from '../src/shared/drop-order.ts';
import { isRewardFarmableNow } from '../src/shared/reward-scheduling.ts';
import type { TwitchDrop } from '../src/types/index.ts';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function reward(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward',
    name: 'Reward',
    gameId: 'game',
    gameName: 'Game',
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    requiredMinutes: 60,
    remainingMinutes: 60,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

describe('reward availability period', () => {
  test('waits until a future reward starts, including the exact boundary', () => {
    const drop = reward({ startsAt: new Date(NOW + 1).toISOString() });
    expect(isRewardFarmableNow(drop, NOW)).toBe(false);
    expect(isRewardFarmableNow(drop, NOW + 1)).toBe(true);
  });

  test('rejects expired rewards even when remaining watch time is unknown', () => {
    const drop = reward({
      endsAt: new Date(NOW).toISOString(),
      requiredMinutes: null,
      remainingMinutes: null,
    });
    expect(isRewardFarmableNow(drop, NOW)).toBe(false);
    expect(isRewardFarmableNow(drop, NOW + 1)).toBe(false);
  });

  test('preserves claimable rewards after their watch period ends', () => {
    expect(
      isRewardFarmableNow(reward({ claimable: true, endsAt: new Date(NOW - 1).toISOString() }), NOW),
    ).toBe(true);
  });

  test('tolerates absent or invalid period timestamps', () => {
    expect(isRewardFarmableNow(reward(), NOW)).toBe(true);
    expect(isRewardFarmableNow(reward({ startsAt: 'invalid', endsAt: 'invalid' }), NOW)).toBe(true);
  });

  test('nearest-drop selection evaluates the wall clock rather than an array index', () => {
    const live = reward({ id: 'live', startsAt: new Date(Date.now() - 60_000).toISOString() });
    const expired = reward({ id: 'expired', endsAt: new Date(Date.now() - 60_000).toISOString() });
    expect(pickNearestDrop([live])).toEqual(live);
    expect(pickNearestDrop([expired])).toBeNull();
  });
});
