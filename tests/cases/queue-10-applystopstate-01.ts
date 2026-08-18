import { describe, expect, test } from 'bun:test';
import { applyStopState } from '../../src/background/recovery-state.ts';
import { createMinimalState } from '../fixtures/queue-management.ts';

export function registerQueue10Part01() {
  describe('applyStopState', () => {
    test('applies stop state with reason and message', () => {
      const state = createMinimalState();
      applyStopState(state, 'test-reason', 'Test stop message');
      expect(state.appState.lastStopReason).toBe('test-reason');
      expect(state.appState.lastStopMessage).toBe('Test stop message');
    });

    test('applies stop state with null message', () => {
      const state = createMinimalState();
      applyStopState(state, 'test-reason', null);
      expect(state.appState.lastStopReason).toBe('test-reason');
      expect(state.appState.lastStopMessage).toBeNull();
    });

    test('clears recovery state when applying stop', () => {
      const state = createMinimalState({
        stalledRecoveryAttempts: 3,
        recoveryBackoffUntil: Date.now(),
        recoveryNotificationSent: true,
      });
      state.appState.recoveryReason = 'previous-recovery';

      applyStopState(state, 'new-stop', 'message');

      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.recoveryBackoffUntil).toBe(0);
      expect(state.recoveryNotificationSent).toBe(false);
      expect(state.appState.recoveryReason).toBeNull();
    });
  });
}
