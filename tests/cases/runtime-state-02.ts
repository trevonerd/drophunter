import { describe, expect, test } from 'bun:test';
import { clearRotationMetadata } from '../../src/background/runtime-state.ts';
import { createInitialState } from '../../src/shared/utils.ts';

describe('clearRotationMetadata', () => {
  test('clears stale rotation data without changing the rest of app state', () => {
    const state = {
      ...createInitialState(),
      isRunning: true,
      lastRotationReason: 'stalled-progress',
      lastRotationAt: 123_456,
    };

    expect(clearRotationMetadata(state)).toEqual({
      ...state,
      lastRotationReason: null,
      lastRotationAt: null,
    });
  });
});
