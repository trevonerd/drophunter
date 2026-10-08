import { describe, expect, test } from 'bun:test';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('refreshes disabled availability while preserving the other cheap gates', async () => {
    // Given: independent fixtures disabled, paused, or scoped to no favorite candidates.
    const disabled = startFixture();
    disabled.state.appState.autoStartFavoriteGames = false;
    disabled.state.appState.campaignPriorityMode = 'lowest-availability';
    const paused = startFixture();
    paused.state.appState.isPaused = true;
    const empty = startFixture();
    empty.state.appState.farmCategoryScope = 'favorites-only';
    empty.state.appState.favoriteGames = [];

    // When: each fixture receives the same public request.
    const outcomes = await Promise.all([
      disabled.automation.request('campaign-refresh'),
      paused.automation.request('periodic'),
      empty.automation.request('periodic'),
    ]);

    // Then: disabled catalog refresh projects availability, while Pause remains an explicit user gate.
    expect(outcomes).toEqual([
      { kind: 'unchanged', reason: 'disabled' },
      { kind: 'unchanged', reason: 'paused' },
      { kind: 'unchanged', reason: 'no-eligible-campaign' },
    ]);
    expect(disabled.refreshCount()).toBe(1);
    expect(Object.keys(disabled.state.appState.campaignAvailabilityByKey)).toHaveLength(2);
    expect(disabled.state.appState.queue).toEqual([]);
    expect(paused.refreshCount()).toBe(0);
    expect(empty.refreshCount()).toBe(1);
  });
});
