import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { enterPersistentRecovery } from '../../src/background/recovery-state.ts';
import { createMinimalState } from '../fixtures/queue-management.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export function registerQueue11Part01() {
  describe('enterPersistentRecovery', () => {
    let mocks: ChromeMocks;

    beforeEach(() => {
      mocks = setupChromeMocks();
    });

    afterEach(() => {
      mocks.teardown();
    });

    test('increments stalledRecoveryAttempts', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 0 });
      await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
      expect(state.stalledRecoveryAttempts).toBe(1);
    });

    test('calls onSkipCurrentGame when max recovery cycles exceeded', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 5 });
      let skipCalled = false;
      await enterPersistentRecovery(state, 'stalled-progress', 'Test message', {
        onSkipCurrentGame: async () => {
          skipCalled = true;
        },
      });
      expect(skipCalled).toBe(true);
      expect(state.stalledRecoveryAttempts).toBe(6);
    });

    test('does not call onSkipCurrentGame if not provided', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 6 });
      await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
      expect(state.stalledRecoveryAttempts).toBe(7);
    });

    test('sets recoveryBackoffUntil based on attempts', async () => {
      const state = createMinimalState({ stalledRecoveryAttempts: 1 });
      const before = Date.now();
      await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
      expect(state.recoveryBackoffUntil).toBeGreaterThan(before);
      expect(state.lastRecoveryAttemptAt).toBeGreaterThanOrEqual(before);
    });

    test('sets recovery status on appState', async () => {
      const state = createMinimalState();
      await enterPersistentRecovery(state, 'stalled-progress', 'Test message');
      expect(state.appState.recoveryReason).toBe('stalled-progress');
      expect(state.appState.recoveryBackoffUntil).toBe(state.recoveryBackoffUntil);
      expect(state.appState.recoveryAttempts).toBe(1);
    });

    test('sends notification only on first recovery entry', async () => {
      const state = createMinimalState({ recoveryNotificationSent: false });
      const notifications: Array<{ title: string; message: string; priority?: number }> = [];
      await enterPersistentRecovery(state, 'stalled-progress', 'Test message', {
        onNotify: async (title, message, priority) => {
          notifications.push({ title, message, priority });
        },
      });
      expect(state.recoveryNotificationSent).toBe(true);

      await enterPersistentRecovery(state, 'stalled-progress', 'Test message', {
        onNotify: async (title, message, priority) => {
          notifications.push({ title, message, priority });
        },
      });

      expect(notifications).toEqual([
        { title: 'DropHunter is still recovering', message: 'Test message', priority: 1 },
      ]);
      expect(mocks.notifications._notifications).toEqual([]);
    });
  });
}
