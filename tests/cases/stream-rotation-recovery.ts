import { expect, test } from 'bun:test';
import {
  computeRecoveryBackoffMs,
  detectRecoveryProof,
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
  MAX_RECOVERY_BACKOFF_MS,
  MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  RECOVERY_BACKOFF_BASE_MS,
  STALLED_PROGRESS_RETRY_MS,
  shouldIncrementNoProgressRotationAttempts,
} from '../../src/background/stream-rotation.ts';

export function registerStreamRecoveryCases() {
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

  test('only stalled rotations increment no-progress retry attempts', () => {
    expect(shouldIncrementNoProgressRotationAttempts('stalled-progress')).toBe(true);
    expect(shouldIncrementNoProgressRotationAttempts('open-failed')).toBe(false);
    expect(shouldIncrementNoProgressRotationAttempts('no-streamers')).toBe(false);
    expect(shouldIncrementNoProgressRotationAttempts('offline')).toBe(false);
    expect(shouldIncrementNoProgressRotationAttempts('wrong-channel')).toBe(false);
    expect(shouldIncrementNoProgressRotationAttempts('wrong-game')).toBe(false);
    expect(shouldIncrementNoProgressRotationAttempts('drops-inactive')).toBe(false);
  });

  test('retry attempts stop at the configured cap', () => {
    let attempts = 0;
    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
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
    expect(nextNoProgressRotationAttempts(2, 'open-failed')).toBe(2);
    expect(nextNoProgressRotationAttempts(2, 'no-streamers')).toBe(2);
    expect(nextNoProgressRotationAttempts(2, 'missing-context')).toBe(2);
  });

  test('no streamer retry window is exactly one minute', () => {
    expect(NO_STREAMERS_RETRY_MS).toBe(60_000);
  });

  test('stalled progress recovery is capped to three human-readable attempts', () => {
    expect(MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS).toBe(3);
    expect(STALLED_PROGRESS_RETRY_MS).toBe(60_000);
  });
}
