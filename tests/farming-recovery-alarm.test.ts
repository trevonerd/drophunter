import { verifyExpectedDiagnostics } from './support/expected-diagnostics.ts';

// These recovery/failure scenarios must emit only their declared diagnostic text.
verifyExpectedDiagnostics([
  ['[DropHunter] Farming recovery alarm unavailable; monitoring heartbeat remains active', 1],
]);

import { expect, test } from 'bun:test';
import { flushRuntimeDiagnosticsForTests } from '../src/background/runtime-diagnostics.ts';
import { saveState } from '../src/background/state-persistence.ts';
import { createMinimalState } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

test('saving state again does not slide an existing near-term recovery alarm', async () => {
  const mocks = setupChromeMocks();
  try {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.recoveryReason = 'open-failed';
    state.appState.recoveryBackoffUntil = Date.now() + 10_000;
    await saveState(state);
    await saveState(state);
    expect(mocks.alarms._created.filter((alarm) => alarm.name === 'farmingRecoveryRetry')).toHaveLength(1);
  } finally {
    await flushRuntimeDiagnosticsForTests();
    mocks.teardown();
  }
});

test('failed farming alarm creation is persisted as a visible fallback status', async () => {
  const mocks = setupChromeMocks();
  try {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.recoveryReason = 'open-failed';
    state.appState.recoveryBackoffUntil = Date.now() + 30_000;
    Reflect.set(chrome.alarms, 'create', () => {
      throw new Error('alarm unavailable');
    });
    await saveState(state);
    expect(state.appState.recoverySchedulerUnavailable).toBe(true);
    const saved = await mocks.storage.local.get('appState');
    expect((saved.appState as { recoverySchedulerUnavailable?: boolean }).recoverySchedulerUnavailable).toBe(
      true,
    );
  } finally {
    await flushRuntimeDiagnosticsForTests();
    mocks.teardown();
  }
});
