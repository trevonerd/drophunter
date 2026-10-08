import { describe, expect, test } from 'bun:test';
import { createDeferred, flushMicrotasks } from '../support/farming-automation-fixtures.ts';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('lets a newer state mutation supersede an evaluation during refresh', async () => {
    // Given: automation is refreshing from an enabled, unpaused fingerprint.
    const gate = createDeferred<void>();
    const subject = startFixture(gate.promise);
    const pending = subject.automation.request('periodic');
    await flushMicrotasks();

    // When: pause state changes before immutable refresh returns.
    subject.state.appState.isPaused = true;
    gate.resolve(undefined);

    // Then: the stale evaluation returns superseded without preparing or committing B.
    expect({ outcome: await pending, running: subject.state.appState.isRunning }).toEqual({
      outcome: { kind: 'unchanged', reason: 'superseded-by-state-change' },
      running: false,
    });
  });
});
