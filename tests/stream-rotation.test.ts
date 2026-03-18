import { expect, test } from 'bun:test';
import {
  MAX_NO_PROGRESS_ROTATION_ATTEMPTS,
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

test('offline rotations keep the current retry count unchanged', () => {
  expect(nextNoProgressRotationAttempts(2, 'offline')).toBe(2);
  expect(nextNoProgressRotationAttempts(2, 'missing-context')).toBe(2);
});
