import { describe, expect, test } from 'bun:test';
import { resetStreamTrackingState } from '../../src/background/session-lifecycle.ts';
import { createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue09Part01() {
  describe('resetStreamTrackingState', () => {
    test('resets all tracking state values', () => {
      const state = createMinimalState({
        invalidStreamChecks: 5,
        lastStreamRotationAt: Date.now(),
        streamValidationGraceUntil: Date.now() + 10000,
        lastTrackedProgress: 50,
        lastTrackedMinutes: 10,
        lastTrackedDropKey: 'drop-123',
        lastProgressAdvanceAt: Date.now(),
        noProgressRotationAttempts: 3,
        stalledRecoveryAttempts: 2,
        recoveryBackoffUntil: Date.now() + 10000,
        lastRecoveryAttemptAt: Date.now(),
      });
      state.appState.recoveryReason = 'test-reason';
      state.appState.recoveryBackoffUntil = Date.now();
      state.appState.recoveryAttempts = 3;

      resetStreamTrackingState(state);

      expect(state.invalidStreamChecks).toBe(0);
      expect(state.lastStreamRotationAt).toBe(0);
      expect(state.streamValidationGraceUntil).toBe(0);
      expect(state.lastTrackedProgress).toBe(-1);
      expect(state.lastTrackedMinutes).toBe(-1);
      expect(state.lastTrackedDropKey).toBeNull();
      expect(state.lastProgressAdvanceAt).toBe(0);
      expect(state.noProgressRotationAttempts).toBe(0);
      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.recoveryBackoffUntil).toBe(0);
      expect(state.lastRecoveryAttemptAt).toBe(0);
    });

    test('clears recovery status from appState', () => {
      const state = createMinimalState();
      state.appState.recoveryReason = 'test';
      state.appState.recoveryBackoffUntil = Date.now();
      state.appState.recoveryAttempts = 3;

      resetStreamTrackingState(state);

      expect(state.appState.recoveryReason).toBeNull();
      expect(state.appState.recoveryBackoffUntil).toBeNull();
      expect(state.appState.recoveryAttempts).toBeNull();
    });
  });
}
