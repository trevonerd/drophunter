import { expect, test } from 'bun:test';
import { createUserStatusModel } from '../src/shared/user-status.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('reduces recovery status to the reason and next retry', () => {
  // Given
  const state = createInitialState();
  state.isRunning = true;
  state.recoveryReason = 'twitch-network';
  state.recoveryAttempts = 4;
  state.recoveryBackoffUntil = 30_000;

  // When
  const status = createUserStatusModel({
    state,
    runtimeMode: 'recovering',
    currentAutomatableDrop: null,
    recoveryNow: 0,
  });

  // Then
  expect(status).toMatchObject({
    mode: 'recovering',
    label: 'Recovering',
    badge: 'RECOVERING',
    detail: 'Twitch request failed; checking connection · retry in 30s',
  });
});

test('explains when the alarm failed and periodic checks remain available', () => {
  const state = createInitialState();
  state.isRunning = true;
  state.recoveryReason = 'open-failed';
  state.recoveryBackoffUntil = 30_000;
  state.recoverySchedulerUnavailable = true;
  const status = createUserStatusModel({
    state,
    runtimeMode: 'recovering',
    currentAutomatableDrop: null,
    recoveryNow: 0,
  });
  expect(status.detail).toContain('Retry reminder unavailable; periodic checks continue.');
});

test('presents completed queues as completion instead of a generic stop', () => {
  // Given
  const state = createInitialState();
  state.lastStopReason = 'queue-complete';

  // When
  const status = createUserStatusModel({
    state,
    runtimeMode: 'stopped-terminal',
    currentAutomatableDrop: null,
    recoveryNow: 0,
  });

  // Then
  expect(status).toMatchObject({
    mode: 'complete',
    label: 'Complete',
    badge: 'COMPLETE',
    detail: 'Queue complete',
  });
});

test('presents exhausted queue retries as an attention state', () => {
  const state = createInitialState();
  state.lastStopReason = 'queue-retries-exhausted';

  const status = createUserStatusModel({
    state,
    runtimeMode: 'stopped-terminal',
    currentAutomatableDrop: null,
    recoveryNow: 0,
  });

  expect(status).toMatchObject({
    mode: 'attention-required',
    label: 'Attention required',
    badge: 'ATTENTION',
    detail: 'Stopped after repeated attempts',
  });
});
