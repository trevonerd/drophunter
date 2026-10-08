import { describe, expect, test } from 'bun:test';
import { gameKey } from '../../src/shared/game-selection.ts';
import { createDeferred, flushMicrotasks } from '../support/farming-automation-fixtures.ts';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('coalesces concurrent triggers into exactly one trailing evaluation', async () => {
    // Given: the first Twitch refresh is held while two more public triggers arrive.
    const gate = createDeferred<void>();
    const subject = startFixture(gate.promise);
    const first = subject.automation.request('periodic');
    await flushMicrotasks();

    // When: campaign-refresh and user-request join the same trailing run.
    const trailingCampaign = subject.automation.request('campaign-refresh');
    const trailingUser = subject.automation.request('user-request');
    gate.resolve(undefined);

    // Then: one active and one shared trailing evaluation produce two refreshes total.
    expect({
      first: await first,
      trailingCampaign: await trailingCampaign,
      trailingUser: await trailingUser,
      refreshCount: subject.refreshCount(),
    }).toEqual({
      first: { kind: 'started', campaignKey: gameKey(subject.best), transition: 'start' },
      trailingCampaign: { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      trailingUser: { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      refreshCount: 2,
    });
  });
});
