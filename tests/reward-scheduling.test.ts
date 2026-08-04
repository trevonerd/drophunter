import { describe, expect, test } from 'bun:test';
import { isRewardCompletableBeforeExpiry } from '../src/shared/reward-scheduling.ts';
import type { TwitchDrop } from '../src/types/index.ts';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');

function drop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'reward-1',
    name: 'Reward',
    gameId: 'game-1',
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

describe('reward scheduling before campaign expiry', () => {
  test('keeps a reward when its remaining watch time fits with the five-minute safety margin', () => {
    const reward = drop({ endsAt: new Date(NOW + 66 * 60_000).toISOString() });

    expect(isRewardCompletableBeforeExpiry(reward, NOW)).toBe(true);
  });

  test('skips a reward when it cannot finish before the five-minute safety margin', () => {
    const reward = drop({ endsAt: new Date(NOW + 64 * 60_000).toISOString() });

    expect(isRewardCompletableBeforeExpiry(reward, NOW)).toBe(false);
  });

  test('keeps already claimable rewards and rewards without reliable timing data', () => {
    expect(
      isRewardCompletableBeforeExpiry(
        drop({ claimable: true, endsAt: new Date(NOW + 60_000).toISOString() }),
        NOW,
      ),
    ).toBe(true);
    expect(isRewardCompletableBeforeExpiry(drop({ endsAt: null }), NOW)).toBe(true);
    expect(
      isRewardCompletableBeforeExpiry(drop({ requiredMinutes: null, remainingMinutes: null }), NOW),
    ).toBe(true);
  });
});
