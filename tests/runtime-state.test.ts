import { describe, expect, test } from 'bun:test';
import {
  clearRotationMetadata,
  createInitialTimingState,
  normalizeTimingState,
  shouldCloseManagedTab,
} from '../src/background/runtime-state.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('normalizeTimingState', () => {
  test('returns defaults for missing input', () => {
    expect(normalizeTimingState(null)).toEqual(createInitialTimingState());
  });

  test('preserves integrity fallback when ttl is still active', () => {
    const now = 1_000;
    const state = normalizeTimingState(
      {
        apiConsecutiveFailures: 2,
        apiBackoffUntil: 4_000,
        integrityFallbackActive: true,
        integrityFallbackActiveUntil: 5_000,
      },
      now,
    );

    expect(state.apiConsecutiveFailures).toBe(2);
    expect(state.apiBackoffUntil).toBe(4_000);
    expect(state.integrityFallbackActive).toBe(true);
    expect(state.integrityFallbackActiveUntil).toBe(5_000);
  });

  test('expires integrity fallback when ttl is in the past', () => {
    const state = normalizeTimingState(
      {
        integrityFallbackActive: true,
        integrityFallbackActiveUntil: 999,
      },
      1_000,
    );

    expect(state.integrityFallbackActive).toBe(false);
    expect(state.integrityFallbackActiveUntil).toBe(0);
  });

  test('preserves active recovery backoff state while the retry window is still active', () => {
    const now = 10_000;
    const state = normalizeTimingState(
      {
        recoveryBackoffUntil: 40_000,
        lastRecoveryAttemptAt: 9_500,
        stalledRecoveryAttempts: 3,
        recoveryNotificationSent: true,
      },
      now,
    );

    expect(state.recoveryBackoffUntil).toBe(40_000);
    expect(state.lastRecoveryAttemptAt).toBe(9_500);
    expect(state.stalledRecoveryAttempts).toBe(3);
    expect(state.recoveryNotificationSent).toBe(true);
  });

  test('expires recovery backoff state when the retry window is already over', () => {
    const state = normalizeTimingState(
      {
        recoveryBackoffUntil: 999,
        lastRecoveryAttemptAt: 900,
        stalledRecoveryAttempts: 2,
        recoveryNotificationSent: true,
      },
      1_000,
    );

    expect(state.recoveryBackoffUntil).toBe(0);
    expect(state.lastRecoveryAttemptAt).toBe(900);
    expect(state.stalledRecoveryAttempts).toBe(2);
    expect(state.recoveryNotificationSent).toBe(false);
  });
});

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

describe('shouldCloseManagedTab', () => {
  test('returns true only when the window has more than one tab', () => {
    expect(shouldCloseManagedTab(2)).toBe(true);
    expect(shouldCloseManagedTab(1)).toBe(false);
    expect(shouldCloseManagedTab(0)).toBe(false);
    expect(shouldCloseManagedTab(null)).toBe(false);
  });
});
