import { expect, test } from 'bun:test';
import { startFixture } from './support/farming-automation-start-fixture.ts';

test('overlapping periodic alarms reuse the persisted evaluation deadline', async () => {
  const run = startFixture();
  await run.automation.request('periodic');
  const deadline = run.state.appState.nextAutomationCheckAt;
  expect(deadline).toBeGreaterThan(2_000);
  const refreshes = run.refreshCount();
  run.setNow(2_001);
  await run.automation.request('periodic');
  expect(run.refreshCount()).toBe(refreshes);
  expect(run.state.appState.nextAutomationCheckAt).toBe(deadline);
  run.setNow(deadline ?? 0);
  await run.automation.request('periodic');
  expect(run.refreshCount()).toBe(refreshes + 1);
});

test.each(['browser-start', 'campaign-refresh', 'user-request'] as const)(
  '%s reevaluates immediately even before the periodic deadline',
  async (trigger) => {
    const run = startFixture();
    await run.automation.request('periodic');
    const refreshes = run.refreshCount();
    await run.automation.request(trigger);
    expect(run.refreshCount()).toBe(refreshes + 1);
  },
);

test('an implausible restored deadline does not indefinitely block favorite discovery', async () => {
  const run = startFixture();
  const facts = await run.persistence.loadFacts();
  if (facts.kind !== 'ready') throw new Error('Missing fixture facts');
  await run.persistence.saveFacts({ ...facts.value, nextEvaluationAt: 2_000 + 86_400_000 });
  expect(await run.automation.request('periodic')).toMatchObject({ kind: 'started' });
  expect(run.refreshCount()).toBe(1);
});
