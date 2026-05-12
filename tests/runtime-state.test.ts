import { describe, expect, test } from 'bun:test';
import {
  applyStartupResumePolicy,
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

describe('applyStartupResumePolicy', () => {
  function makePolicyState() {
    return {
      appState: {
        ...createInitialState(),
        selectedGame: { id: 'game-1', name: 'Game', imageUrl: '' },
        isRunning: true,
        isPaused: false,
        tabId: 123,
        activeStreamer: { id: 'streamer-1', name: 'streamer', displayName: 'Streamer', isLive: true },
        queue: [{ id: 'game-2', name: 'Next Game', imageUrl: '' }],
        recoveryReason: 'stalled-progress',
        recoveryBackoffUntil: 90_000,
        recoveryAttempts: 2,
      },
      lastHeartbeatAt: 1_000,
      recoveryBackoffUntil: 90_000,
      lastRecoveryAttemptAt: 80_000,
      stalledRecoveryAttempts: 2,
      recoveryNotificationSent: true,
    };
  }

  test('pauses stale startup sessions when auto-resume is disabled', () => {
    const state = makePolicyState();
    const result = applyStartupResumePolicy(state, 40_000, 30_000);

    expect(result).toBe('paused-on-startup');
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.isPaused).toBe(true);
    expect(state.appState.selectedGame?.id).toBe('game-1');
    expect(state.appState.queue).toHaveLength(1);
    expect(state.appState.tabId).toBeNull();
    expect(state.appState.activeStreamer).toBeNull();
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.recoveryBackoffUntil).toBe(0);
    expect(state.stalledRecoveryAttempts).toBe(0);
    expect(state.recoveryNotificationSent).toBe(false);
  });

  test('allows crash recovery for stale startup sessions when auto-resume is enabled', () => {
    const state = makePolicyState();
    state.appState.autoResumeOnStartup = true;

    const result = applyStartupResumePolicy(state, 40_000, 30_000);

    expect(result).toBe('auto-resume');
    expect(state.appState.isPaused).toBe(false);
    expect(state.appState.tabId).toBe(123);
    expect(state.appState.activeStreamer?.id).toBe('streamer-1');
  });

  test('does not treat paused, stopped, or recent heartbeat states as stale startup resumes', () => {
    const paused = makePolicyState();
    paused.appState.isPaused = true;
    expect(applyStartupResumePolicy(paused, 40_000, 30_000)).toBe('not-stale');
    expect(paused.appState.isPaused).toBe(true);

    const stopped = makePolicyState();
    stopped.appState.isRunning = false;
    expect(applyStartupResumePolicy(stopped, 40_000, 30_000)).toBe('not-stale');
    expect(stopped.appState.isRunning).toBe(false);

    const recent = makePolicyState();
    recent.lastHeartbeatAt = 35_000;
    expect(applyStartupResumePolicy(recent, 40_000, 30_000)).toBe('not-stale');
    expect(recent.appState.isPaused).toBe(false);
  });
});
