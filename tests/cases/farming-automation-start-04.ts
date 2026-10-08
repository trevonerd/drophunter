import { describe, expect, test } from 'bun:test';
import { gameKey } from '../../src/shared/game-selection.ts';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('keeps Pause across browser-start and resumes only after explicit intent changes', async () => {
    const subject = startFixture();
    subject.state.appState.isPaused = true;

    // When: routine triggers run before the user explicitly resumes.
    const periodic = await subject.automation.request('periodic');
    const browserStart = await subject.automation.request('browser-start');
    subject.state.appState.isPaused = false;
    const resumed = await subject.automation.request('user-request');

    // Then: neither worker nor browser lifecycle bypasses Pause.
    expect({ periodic, browserStart, resumed }).toEqual({
      periodic: { kind: 'unchanged', reason: 'paused' },
      browserStart: { kind: 'unchanged', reason: 'paused' },
      resumed: { kind: 'started', campaignKey: gameKey(subject.best), transition: 'start' },
    });
  });
});
