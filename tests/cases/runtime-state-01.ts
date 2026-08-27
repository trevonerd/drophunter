import { describe, expect, test } from 'bun:test';
import {
  createInitialTimingState,
  createServiceWorkerState,
  normalizeTimingState,
} from '../../src/background/runtime-state.ts';

describe('normalizeTimingState', () => {
  test('returns defaults for missing input', () => {
    expect(normalizeTimingState(null)).toEqual(createInitialTimingState());
  });

  test('defaults unverifiable reward markers to an empty record', () => {
    expect(normalizeTimingState(null).unverifiableRewardsByKey).toEqual({});
    expect(createServiceWorkerState().unverifiableRewardsByKey).toEqual({});
  });

  test('accepts valid unverifiable reward markers and rejects malformed entries and identities', () => {
    const state = normalizeTimingState({
      unverifiableRewardsByKey: {
        '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
        garbage: { progress: 1, currentMinutes: 1, markedAt: 1 },
        '["campaign","nan-progress"]': { progress: Number.NaN, currentMinutes: 1, markedAt: 1 },
        '["campaign","negative-minutes"]': { progress: 1, currentMinutes: -1, markedAt: 1 },
        '["campaign","negative-marked-at"]': { progress: 1, currentMinutes: 1, markedAt: -1 },
        '["campaign","non-record"]': 'invalid',
      },
    });

    expect(state.unverifiableRewardsByKey).toEqual({
      '["campaign","reward"]': { progress: 99, currentMinutes: 59, markedAt: 123_456 },
    });
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
        lastTrackedDropKey: 'drop::campaign::game::name::image',
      },
      now,
    );

    expect(state.recoveryBackoffUntil).toBe(40_000);
    expect(state.lastRecoveryAttemptAt).toBe(9_500);
    expect(state.stalledRecoveryAttempts).toBe(3);
    expect(state.recoveryNotificationSent).toBe(true);
    expect(state.lastTrackedDropKey).toBe('drop::campaign::game::name::image');
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

  test('restores offlineChecks and avoidStreamerName so they survive a service worker restart', () => {
    const state = normalizeTimingState({
      offlineChecks: 1,
      avoidStreamerName: 'bad-streamer',
    });

    expect(state.offlineChecks).toBe(1);
    expect(state.avoidStreamerName).toBe('bad-streamer');
  });

  test('defaults offlineChecks and avoidStreamerName when missing from saved input', () => {
    const state = normalizeTimingState({});

    expect(state.offlineChecks).toBe(0);
    expect(state.avoidStreamerName).toBeNull();
  });

  test('discards a non-string or empty avoidStreamerName', () => {
    expect(normalizeTimingState({ avoidStreamerName: '' }).avoidStreamerName).toBeNull();
    expect(normalizeTimingState({ avoidStreamerName: 42 }).avoidStreamerName).toBeNull();
  });

  test('discards a non-finite offlineChecks', () => {
    expect(normalizeTimingState({ offlineChecks: Number.NaN }).offlineChecks).toBe(0);
    expect(normalizeTimingState({ offlineChecks: 'two' }).offlineChecks).toBe(0);
  });
});
