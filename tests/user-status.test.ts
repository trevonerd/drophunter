import { expect, test } from 'bun:test';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { normalizeWatchHealth } from '../src/shared/app-state-runtime-normalizers.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createUserStatusModel } from '../src/shared/user-status.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('popup and monitor request a video gesture without showing active progress or a retry countdown', () => {
  const state = createInitialState();
  state.isRunning = true;
  state.watchHealth = normalizeWatchHealth(
    createWatchHealth('managed-tab', 'degraded', 'user-interaction-required', () => 100),
  );
  expect(state.watchHealth?.reason).toBe('user-interaction-required');
  const status = createUserStatusModel({
    state,
    runtimeMode: 'running',
    currentAutomatableDrop: null,
    recoveryNow: 100,
  });
  expect(status).toMatchObject({
    mode: 'attention-required',
    progressState: 'waiting',
    label: 'Start the video',
  });
  expect(status.detail).toContain('Click Play');
  expect(status.detail).not.toContain('retry');
  expect(
    createUserStatusModel({ state, runtimeMode: 'paused', currentAutomatableDrop: null, recoveryNow: 100 })
      .mode,
  ).toBe('paused');
});

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

test('a reserved channel still loading after queue Play shows switching, not recovery', () => {
  // Given
  const state = createInitialState();
  const game = { id: 'hs', name: 'Hearthstone', imageUrl: '', campaignId: 'hs-1', campaignName: 'Season' };
  state.isRunning = true;
  state.selectedGame = game;
  state.recoveryReason = 'open-failed';
  state.recoveryBackoffUntil = 30_000;
  const status = (preparing: boolean) => {
    state.queueEntryMetadataByKey = {
      [gameKey(game)]: {
        source: 'manual',
        addedAt: 0,
        reason: 'user-added',
        watchAttempt: { channelName: 'loader', observedAt: 0, ...(preparing ? { preparing } : {}) },
      },
    };
    return createUserStatusModel({
      state,
      runtimeMode: 'recovering',
      currentAutomatableDrop: null,
      recoveryNow: 0,
    });
  };

  // When
  const preparing = status(true);
  const failed = status(false);

  // Then
  expect(preparing).toMatchObject({
    mode: 'pending-validation',
    label: 'Switching to',
    detail: 'Preparing loader.',
  });
  expect(failed.mode).toBe('recovering');
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
