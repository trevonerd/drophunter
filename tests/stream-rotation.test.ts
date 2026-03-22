import { expect, test } from 'bun:test';
import {
  classifyStreamHealth,
  computeRecoveryBackoffMs,
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
  MAX_RECOVERY_BACKOFF_MS,
  RECOVERY_BACKOFF_BASE_MS,
  didDropProgressAdvance,
  nextNoProgressRotationAttempts,
  shouldIncrementNoProgressRotationAttempts,
} from '../src/background/stream-rotation.ts';

test('progress advance is detected only when the percentage increases', () => {
  expect(didDropProgressAdvance(10, 11)).toBe(true);
  expect(didDropProgressAdvance(10, 10)).toBe(false);
  expect(didDropProgressAdvance(10, 9)).toBe(false);
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
