import { expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { getRecoveryPresentation } from '../src/shared/recovery-presentation.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('shared recovery contract identifies operation, phase, deadline, and available action', () => {
  const state = createInitialState();
  state.isRunning = true;
  state.recoveryReason = 'open-failed';
  state.recoveryBackoffUntil = 31_000;
  const stored = normalizeStoredAppState(state);
  expect(getRecoveryPresentation(stored, 1_000)).toEqual({
    phase: 'scheduled',
    operation: 'start-playback',
    reason: 'open-failed',
    nextRetryAt: 31_000,
    action: 'retry',
  });
  expect(getRecoveryPresentation(stored, 31_000)?.phase).toBe('due');
});

test('rate limits keep Retry unavailable until their verified deadline', () => {
  const state = createInitialState();
  state.isRunning = true;
  state.recoveryReason = 'twitch-rate-limit';
  state.recoveryBackoffUntil = 600_000;
  expect(getRecoveryPresentation(state, 1_000)).toMatchObject({
    phase: 'extended',
    operation: 'refresh-twitch-data',
    action: 'wait',
  });
  expect(getRecoveryPresentation(state, 600_000)?.action).toBe('retry');
});

test('Pause never offers Retry and malformed deadlines are unscheduled', () => {
  const state = createInitialState();
  state.isRunning = true;
  state.isPaused = true;
  state.recoveryReason = 'twitch-integrity';
  state.recoveryBackoffUntil = Number.POSITIVE_INFINITY;
  expect(getRecoveryPresentation(normalizeStoredAppState(state))).toMatchObject({
    phase: 'unscheduled',
    operation: 'verify-integrity',
    action: 'wait',
    nextRetryAt: null,
  });
});
