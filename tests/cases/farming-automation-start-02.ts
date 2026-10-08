import { describe, expect, test } from 'bun:test';
import { gameKey } from '../../src/shared/game-selection.ts';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('starts eligible favorites when notifications are unavailable or disabled', async () => {
    const fixture = startFixture(Promise.resolve(), false);
    fixture.state.appState.notificationsEnabled = false;

    const outcome = await fixture.automation.request('campaign-refresh');

    expect(outcome).toEqual({
      kind: 'started',
      campaignKey: gameKey(fixture.best),
      transition: 'start',
    });
    expect(fixture.events).not.toContain(
      'notification:farming-transition:start:idle:campaign:campaign-best:1000',
    );
  });
});
