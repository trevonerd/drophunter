import { describe, expect, test } from 'bun:test';
import { gameKey } from '../../src/shared/game-selection.ts';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('starts the highest-ranked eligible campaign through the public interface', async () => {
    // Given: two eligible campaigns sharing a game ID, with the earlier campaign ranked first.
    const fixture = startFixture();

    // When: the periodic public request evaluates the complete automation pipeline.
    // Then: the real Session transition commits the campaign-aware winner.
    const outcome = await fixture.automation.request('periodic');
    expect(outcome).toEqual({
      kind: 'started',
      campaignKey: gameKey(fixture.best),
      transition: 'start',
    });
    expect(gameKey(fixture.state.appState.selectedGame ?? fixture.best)).toBe(gameKey(fixture.best));
    expect(Object.keys(fixture.state.appState.campaignAvailabilityByKey)).toHaveLength(2);
    expect(fixture.events).toEqual([
      'refresh',
      'broadcast',
      'broadcast',
      'commit',
      'facts',
      'broadcast',
      'alarm',
      'monitor',
    ]);
  });
});
