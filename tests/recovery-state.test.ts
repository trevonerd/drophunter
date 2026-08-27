import { describe, expect, test } from 'bun:test';
import { enterPersistentRecovery } from '../src/background/recovery-state.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

describe('enterPersistentRecovery', () => {
  test('fires onNotify and onSystemAlert once on first entry', async () => {
    // Given
    const state = createServiceWorkerState();
    const notifyCalls: Array<{ title: string; message: string }> = [];
    const systemAlerts: Array<{ reason: string; message: string }> = [];

    // When
    await enterPersistentRecovery(state, 'stalled-progress', 'Stream stalled, retrying.', {
      onNotify: async (title, message) => {
        notifyCalls.push({ title, message });
      },
      onSystemAlert: async (reason, message) => {
        systemAlerts.push({ reason, message });
      },
    });

    // Then
    expect(notifyCalls).toEqual([
      { title: 'DropHunter is still recovering', message: 'Stream stalled, retrying.' },
    ]);
    expect(systemAlerts).toEqual([{ reason: 'persistent-recovery', message: 'Stream stalled, retrying.' }]);
    expect(state.recoveryNotificationSent).toBe(true);
  });

  test('does not re-fire onSystemAlert on a subsequent recovery cycle', async () => {
    // Given
    const state = createServiceWorkerState();
    const systemAlerts: Array<{ reason: string; message: string }> = [];
    await enterPersistentRecovery(state, 'stalled-progress', 'First attempt.', {
      onSystemAlert: async (reason, message) => {
        systemAlerts.push({ reason, message });
      },
    });

    // When
    await enterPersistentRecovery(state, 'stalled-progress', 'Second attempt.', {
      onSystemAlert: async (reason, message) => {
        systemAlerts.push({ reason, message });
      },
    });

    // Then
    expect(systemAlerts).toEqual([{ reason: 'persistent-recovery', message: 'First attempt.' }]);
  });
});
