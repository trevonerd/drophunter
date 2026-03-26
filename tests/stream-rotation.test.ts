import { describe, expect, test } from 'bun:test';
import {
  classifyStreamHealth,
  computeRecoveryBackoffMs,
  detectRecoveryProof,
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
  MAX_PERSISTENT_RECOVERY_CYCLES,
  MAX_RECOVERY_BACKOFF_MS,
  RECOVERY_BACKOFF_BASE_MS,
  didDropProgressAdvance,
  didDropMinutesAdvance,
  computeEffectiveStallThreshold,
  nextNoProgressRotationAttempts,
  shouldIncrementNoProgressRotationAttempts,
} from '../src/background/stream-rotation.ts';

test('progress advance is detected only when the percentage increases', () => {
  expect(didDropProgressAdvance(10, 11)).toBe(true);
  expect(didDropProgressAdvance(10, 10)).toBe(false);
  expect(didDropProgressAdvance(10, 9)).toBe(false);
});

test('recovery proof is detected when the same drop resumes progress', () => {
  expect(
    detectRecoveryProof({
      previousDropKey: 'drop-a',
      previousProgress: 34,
      nextDropKey: 'drop-a',
      nextProgress: 35,
      previousCompletedKeys: [],
      nextCompletedKeys: [],
    }),
  ).toBe(true);
});

test('recovery proof is detected when a completed drop hands off to the next active drop', () => {
  expect(
    detectRecoveryProof({
      previousDropKey: 'drop-a',
      previousProgress: 100,
      nextDropKey: 'drop-b',
      nextProgress: 0,
      previousCompletedKeys: [],
      nextCompletedKeys: ['drop-a'],
    }),
  ).toBe(true);
});

test('recovery proof is not detected when the active drop changed without new completion or progress', () => {
  expect(
    detectRecoveryProof({
      previousDropKey: 'drop-a',
      previousProgress: 42,
      nextDropKey: 'drop-b',
      nextProgress: 42,
      previousCompletedKeys: [],
      nextCompletedKeys: [],
    }),
  ).toBe(false);
});

test('only stalled rotations and open failures increment retry attempts', () => {
  expect(shouldIncrementNoProgressRotationAttempts('stalled-progress')).toBe(true);
  expect(shouldIncrementNoProgressRotationAttempts('open-failed')).toBe(true);
  expect(shouldIncrementNoProgressRotationAttempts('offline')).toBe(false);
  expect(shouldIncrementNoProgressRotationAttempts('wrong-channel')).toBe(false);
  expect(shouldIncrementNoProgressRotationAttempts('wrong-game')).toBe(false);
  expect(shouldIncrementNoProgressRotationAttempts('drops-inactive')).toBe(false);
});

test('retry attempts stop at the configured cap', () => {
  let attempts = 0;
  attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
  attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
  attempts = nextNoProgressRotationAttempts(attempts, 'open-failed');
  expect(attempts).toBe(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);

  attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
  expect(attempts).toBe(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);
});

test('recovery backoff grows exponentially and caps at the configured maximum', () => {
  expect(computeRecoveryBackoffMs(1)).toBe(RECOVERY_BACKOFF_BASE_MS);
  expect(computeRecoveryBackoffMs(2)).toBe(RECOVERY_BACKOFF_BASE_MS * 2);
  expect(computeRecoveryBackoffMs(3)).toBe(RECOVERY_BACKOFF_BASE_MS * 4);
  expect(computeRecoveryBackoffMs(99)).toBe(MAX_RECOVERY_BACKOFF_MS);
});

test('offline rotations keep the current retry count unchanged', () => {
  expect(nextNoProgressRotationAttempts(2, 'offline')).toBe(2);
  expect(nextNoProgressRotationAttempts(2, 'missing-context')).toBe(2);
});

test('healthy live stream with matching game and drops signal does not request recovery', () => {
  expect(
    classifyStreamHealth({
      isLive: true,
      sameChannel: true,
      sameGame: true,
      hasDropsSignal: true,
      progressStalled: false,
      expectsDropsSignal: true,
    }),
  ).toEqual({
    isHealthy: true,
    forceImmediateRotation: false,
    invalidIncrement: 0,
    reason: null,
  });
});

test('wrong game requests a non-stall recovery', () => {
  expect(
    classifyStreamHealth({
      isLive: true,
      sameChannel: true,
      sameGame: false,
      hasDropsSignal: true,
      progressStalled: false,
      expectsDropsSignal: true,
    }),
  ).toEqual({
    isHealthy: false,
    forceImmediateRotation: false,
    invalidIncrement: 2,
    reason: 'wrong-game',
  });
});

test('missing drops signal requests a slow recovery only when drops are expected', () => {
  expect(
    classifyStreamHealth({
      isLive: true,
      sameChannel: true,
      sameGame: true,
      hasDropsSignal: false,
      progressStalled: false,
      expectsDropsSignal: true,
    }),
  ).toEqual({
    isHealthy: false,
    forceImmediateRotation: false,
    invalidIncrement: 1,
    reason: 'drops-inactive',
  });

  expect(
    classifyStreamHealth({
      isLive: true,
      sameChannel: true,
      sameGame: true,
      hasDropsSignal: false,
      progressStalled: false,
      expectsDropsSignal: false,
    }),
  ).toEqual({
    isHealthy: true,
    forceImmediateRotation: false,
    invalidIncrement: 0,
    reason: null,
  });
});

test('offline stream requests recovery', () => {
  expect(
    classifyStreamHealth({
      isLive: false,
      sameChannel: true,
      sameGame: true,
      hasDropsSignal: true,
      progressStalled: false,
      expectsDropsSignal: true,
    }),
  ).toEqual({
    isHealthy: false,
    forceImmediateRotation: true,
    invalidIncrement: 0,
    reason: 'offline',
  });
});

test('stalled progress requests immediate recovery', () => {
  const result = classifyStreamHealth({
    isLive: true,
    sameChannel: true,
    sameGame: true,
    hasDropsSignal: true,
    progressStalled: true,
    expectsDropsSignal: true,
  });

  expect(result.isHealthy).toBe(false);
  expect(result.forceImmediateRotation).toBe(false);
  expect(result.reason).toBe('stalled-progress');
  expect(result.invalidIncrement).toBeGreaterThan(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);
});

test('persistent recovery cycle cap exceeds the rotation attempt cap', () => {
  expect(MAX_PERSISTENT_RECOVERY_CYCLES).toBeGreaterThan(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);
});

// ---------------------------------------------------------------------------
// didDropMinutesAdvance
// ---------------------------------------------------------------------------

describe('didDropMinutesAdvance', () => {
  test('returns true when currentMinutes is greater than previousMinutes', () => {
    expect(didDropMinutesAdvance(10, 11)).toBe(true);
  });

  test('returns false when currentMinutes equals previousMinutes', () => {
    expect(didDropMinutesAdvance(10, 10)).toBe(false);
  });

  test('returns false when currentMinutes is less than previousMinutes (API clock skew)', () => {
    expect(didDropMinutesAdvance(10, 9)).toBe(false);
  });

  test('returns true on first tracking when previousMinutes is -1 and currentMinutes is 0', () => {
    expect(didDropMinutesAdvance(-1, 0)).toBe(true);
  });

  test('returns false when both are -1 (uninitialized state)', () => {
    expect(didDropMinutesAdvance(-1, -1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeEffectiveStallThreshold
// ---------------------------------------------------------------------------

describe('computeEffectiveStallThreshold', () => {
  test('returns 5-minute floor for short drops where formula < 5min (requiredMinutes = 60)', () => {
    // formula: (60/100)*2+1 = 2.2 min → floor applies
    expect(computeEffectiveStallThreshold(60)).toBe(5 * 60_000);
  });

  test('returns formula result for medium drops (requiredMinutes = 300)', () => {
    // formula: (300/100)*2+1 = 7 min
    expect(computeEffectiveStallThreshold(300)).toBe(7 * 60_000);
  });

  test('returns formula result for long drops (requiredMinutes = 500)', () => {
    // formula: (500/100)*2+1 = 11 min
    expect(computeEffectiveStallThreshold(500)).toBe(11 * 60_000);
  });

  test('returns formula result for very long drops (requiredMinutes = 720)', () => {
    // formula: (720/100)*2+1 = 15.4 min
    expect(computeEffectiveStallThreshold(720)).toBe(15.4 * 60_000);
  });

  test('returns 5-minute floor when requiredMinutes is null', () => {
    expect(computeEffectiveStallThreshold(null)).toBe(5 * 60_000);
  });

  test('returns 5-minute floor when requiredMinutes is undefined', () => {
    expect(computeEffectiveStallThreshold(undefined)).toBe(5 * 60_000);
  });

  test('returns 5-minute floor when requiredMinutes is 0', () => {
    expect(computeEffectiveStallThreshold(0)).toBe(5 * 60_000);
  });

  test('returns 5-minute floor for minimal drops (requiredMinutes = 1)', () => {
    // formula: (1/100)*2+1 = 1.02 min < 5 min → floor applies
    expect(computeEffectiveStallThreshold(1)).toBe(5 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// Boundary scenarios: stall detection integration
// ---------------------------------------------------------------------------

test('long drop: minutes advancing while integer % stays same does not indicate stall', () => {
  // requiredMinutes = 480, minutes go from 147 to 148: both floor to 30%
  const requiredMinutes = 480;
  const prevMinutes = 147;
  const nextMinutes = 148;
  const prevProgress = Math.floor((prevMinutes / requiredMinutes) * 100); // 30
  const nextProgress = Math.floor((nextMinutes / requiredMinutes) * 100); // 30
  expect(didDropProgressAdvance(prevProgress, nextProgress)).toBe(false); // integer unchanged
  expect(didDropMinutesAdvance(prevMinutes, nextMinutes)).toBe(true); // minutes advanced
  // A stall should NOT be declared when minutes advance, even if integer % doesn't
});

test('short drop: neither minutes nor progress advance indicates stall correctly', () => {
  expect(didDropProgressAdvance(30, 30)).toBe(false);
  expect(didDropMinutesAdvance(18, 18)).toBe(false);
  // Both false → stall can be declared
});

test('exact boundary: requiredMinutes=500 gives 11-minute threshold, not 5-minute', () => {
  const threshold = computeEffectiveStallThreshold(500);
  expect(threshold).toBe(11 * 60_000);
  expect(threshold).toBeGreaterThan(5 * 60_000);
});
