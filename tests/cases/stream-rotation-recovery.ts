import { expect, test } from 'bun:test';
import {
  detectRecoveryProof,
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  STALLED_PROGRESS_RETRY_MS,
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

  test('retry attempts stop at the configured cap', () => {
    let attempts = 0;
    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
    expect(attempts).toBe(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);

    attempts = nextNoProgressRotationAttempts(attempts, 'stalled-progress');
    expect(attempts).toBe(MAX_NO_PROGRESS_ROTATION_ATTEMPTS);
  });

  test('offline rotations keep the current retry count unchanged', () => {
    expect(nextNoProgressRotationAttempts(2, 'offline')).toBe(2);
    expect(nextNoProgressRotationAttempts(2, 'open-failed')).toBe(2);
    expect(nextNoProgressRotationAttempts(2, 'no-streamers')).toBe(2);
    expect(nextNoProgressRotationAttempts(2, 'missing-context')).toBe(2);
  });

  test('no streamer retry window is thirty seconds', () => {
    expect(NO_STREAMERS_RETRY_MS).toBe(30_000);
  });

  test('stalled progress retry spacing is one minute', () => {
    expect(STALLED_PROGRESS_RETRY_MS).toBe(60_000);
  });
}
