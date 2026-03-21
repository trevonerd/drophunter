import { describe, expect, test } from 'bun:test';
import {
  applyRecoveryStatus,
  applyTerminalStopStatus,
  clearRecoveryStatus,
  clearTerminalStopStatus,
  deriveRuntimeMode,
  formatRecoveryReason,
  formatRetryLabel,
  formatRotationReason,
  getRecoveryState,
  getTerminalStopState,
} from '../src/shared/runtime-status.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('deriveRuntimeMode', () => {
  test('prefers recovering over running when recovery metadata exists', () => {
    const state = {
      ...createInitialState(),
      isRunning: true,
      recoveryReason: 'stalled-progress',
    };

    expect(deriveRuntimeMode(state)).toBe('recovering');
  });

  test('returns paused when farming is paused', () => {
    const state = {
      ...createInitialState(),
      isRunning: true,
      isPaused: true,
    };

    expect(deriveRuntimeMode(state)).toBe('paused');
  });

  test('returns stopped-terminal when the session ended with a terminal stop', () => {
    const state = {
      ...createInitialState(),
      lastStopReason: 'queue-complete',
    };

    expect(deriveRuntimeMode(state)).toBe('stopped-terminal');
  });
});

describe('runtime status transitions', () => {
  test('applyRecoveryStatus clears terminal stop metadata', () => {
    const next = applyRecoveryStatus(
      {
        ...createInitialState(),
        lastStopReason: 'sign-in-required',
        lastStopMessage: 'Please sign in.',
      },
      { reason: 'stalled-progress', retryAt: 5_000, attempts: 2 },
    );

    expect(next.recoveryReason).toBe('stalled-progress');
    expect(next.recoveryBackoffUntil).toBe(5_000);
    expect(next.recoveryAttempts).toBe(2);
    expect(next.lastStopReason).toBeNull();
    expect(next.lastStopMessage).toBeNull();
  });

  test('applyTerminalStopStatus clears recovery metadata', () => {
    const next = applyTerminalStopStatus(
      {
        ...createInitialState(),
        recoveryReason: 'open-failed',
        recoveryBackoffUntil: 9_000,
        recoveryAttempts: 3,
      },
      { reason: 'queue-complete', message: 'Queue completed.' },
    );

    expect(next.lastStopReason).toBe('queue-complete');
    expect(next.lastStopMessage).toBe('Queue completed.');
    expect(next.recoveryReason).toBeNull();
    expect(next.recoveryBackoffUntil).toBeNull();
    expect(next.recoveryAttempts).toBeNull();
  });

  test('clear helpers only clear their own metadata', () => {
    const base = {
      ...createInitialState(),
      recoveryReason: 'offline',
      recoveryBackoffUntil: 4_000,
      recoveryAttempts: 1,
      lastStopReason: 'user-stop',
      lastStopMessage: 'Stopped by user.',
    };

    const withoutRecovery = clearRecoveryStatus(base);
    expect(withoutRecovery.recoveryReason).toBeNull();
    expect(withoutRecovery.lastStopReason).toBe('user-stop');

    const withoutStop = clearTerminalStopStatus(base);
    expect(withoutStop.lastStopReason).toBeNull();
    expect(withoutStop.recoveryReason).toBe('offline');
  });
});

describe('runtime status selectors', () => {
  test('returns recovery state when available', () => {
    const state = {
      ...createInitialState(),
      recoveryReason: 'wrong-game',
      recoveryBackoffUntil: 12_000,
      recoveryAttempts: 4,
    };

    expect(getRecoveryState(state)).toEqual({
      reason: 'wrong-game',
      retryAt: 12_000,
      attempts: 4,
    });
  });

  test('returns terminal stop state when available', () => {
    const state = {
      ...createInitialState(),
      lastStopReason: 'sign-in-required',
      lastStopMessage: 'Please sign in.',
    };

    expect(getTerminalStopState(state)).toEqual({
      reason: 'sign-in-required',
      message: 'Please sign in.',
    });
  });
});

describe('runtime status formatting', () => {
  test('formats rotation and recovery reasons for the UI', () => {
    expect(formatRotationReason('drops-inactive')).toBe('Drops signal missing');
    expect(formatRecoveryReason('drops-inactive')).toBe('Recovering missing drops signal');
  });

  test('formats retry label only for future timestamps', () => {
    expect(formatRetryLabel(61_000, 1_000)).toBe('retry in 1m');
    expect(formatRetryLabel(1_500, 1_000)).toBe('retry in 1s');
    expect(formatRetryLabel(500, 1_000)).toBeNull();
  });
});
