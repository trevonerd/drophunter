import { describe, expect, test } from 'bun:test';
import { createFarmingAutomationBrowser } from './support/farming-automation-browser.ts';
import { createCampaignFixture, createDeferred } from './support/farming-automation-fixtures.ts';
import { createFarmingAutomationHarness } from './support/farming-automation-harness.ts';
import { createFarmingAutomationPersistence } from './support/farming-automation-persistence.ts';
import { createFarmingAutomationTwitch } from './support/farming-automation-twitch.ts';

describe('Farming automation deterministic adapters', () => {
  test('retains durable state and clears only session data on browser restart', async () => {
    const persistence = createFarmingAutomationPersistence();
    await persistence.setLocal('facts', { version: 1, nextEvaluationAt: 100 });
    await persistence.setSession('snooze', true);

    const reconstructed = persistence.reconstruct();
    expect(await reconstructed.getLocal('facts')).toEqual({ version: 1, nextEvaluationAt: 100 });
    expect(await reconstructed.getSession('snooze')).toBe(true);

    reconstructed.restartBrowser();
    expect(await reconstructed.getLocal('facts')).toEqual({ version: 1, nextEvaluationAt: 100 });
    expect(await reconstructed.getSession('snooze')).toBeUndefined();
  });

  test('reconstructs the harness over durable stores and resets only browser session data', async () => {
    const harness = createFarmingAutomationHarness();
    await harness.persistence.setLocal('facts', { version: 1 });
    await harness.persistence.setSession('snooze', true);

    const reconstructed = harness.reconstruct();
    expect(await reconstructed.persistence.getLocal('facts')).toEqual({ version: 1 });
    expect(await reconstructed.persistence.getSession('snooze')).toBe(true);
    reconstructed.restartBrowser();
    expect(await reconstructed.persistence.getLocal('facts')).toEqual({ version: 1 });
    expect(await reconstructed.persistence.getSession('snooze')).toBeUndefined();
  });

  test('fails before mutation when a persistence write fails', async () => {
    const persistence = createFarmingAutomationPersistence({ local: { before: { stable: true } } });
    const before = persistence.snapshot();
    persistence.failNextWrite('local', new Error('disk full'));

    await expect(persistence.setLocal('after', { changed: true })).rejects.toThrow('disk full');
    expect(persistence.snapshot()).toEqual(before);
    expect(persistence.failures).toEqual([{ store: 'local', message: 'disk full' }]);
  });

  test('records browser ownership and deterministic tab/probe operations', async () => {
    const browser = createFarmingAutomationBrowser();
    const target = { gameId: 'game-1', campaignId: 'campaign-1', channelName: 'streamer' };
    const session = await browser.openManagedTab(target);
    expect(session).toMatchObject({ owner: 'drophunter', active: false, focused: false, muted: true });
    expect(browser.tabs).toHaveLength(1);
    await expect(browser.probe(session, target)).resolves.toMatchObject({ accepted: true });
    await browser.notify('automation started');
    await browser.scheduleAlarm('favoriteCampaignDeadline', 123);
    await browser.close(session);
    expect(browser.operations.map(({ kind }) => kind)).toEqual(['open', 'probe', 'notify', 'alarm', 'close']);
  });

  test('supports typed probe barriers and failpoints without using real time', async () => {
    const browser = createFarmingAutomationBrowser();
    const gate = browser.blockNextProbe();
    const target = { gameId: 'game-1', campaignId: 'campaign-1', channelName: 'streamer' };
    const session = await browser.openManagedTab(target);
    const probe = browser.probe(session, target);
    await gate.started;
    expect(browser.activeProbeCount).toBe(1);
    gate.release();
    await expect(probe).resolves.toMatchObject({ accepted: true });

    browser.failNext('probe', new Error('probe failed'));
    await expect(browser.probe(session, target)).rejects.toThrow('probe failed');
    expect(browser.failures).toEqual([{ operation: 'probe', message: 'probe failed' }]);
  });

  test('retains normalized Twitch snapshots and exposes refresh failure', async () => {
    const game = createCampaignFixture({ campaignId: 'campaign-1' });
    const twitch = createFarmingAutomationTwitch({ games: [game] });
    expect(await twitch.getSnapshot()).toEqual({ games: [game], updatedAt: 0 });

    const refreshGate = twitch.blockNextRefresh();
    const refresh = twitch.refresh();
    await refreshGate.started;
    expect(twitch.refreshCount).toBe(1);
    refreshGate.release();
    await refresh;
    expect(await twitch.getSnapshot()).toEqual({ games: [game], updatedAt: 1 });

    twitch.failNextRefresh(new Error('refresh failed'));
    await expect(twitch.refresh()).rejects.toThrow('refresh failed');
    expect(await twitch.getSnapshot()).toEqual({ games: [game], updatedAt: 1 });
    expect(twitch.failures).toEqual([{ operation: 'refresh', message: 'refresh failed' }]);
  });

  test('fixture deferred values can release a full adapter workflow deterministically', async () => {
    const deferred = createDeferred<number>();
    const values: number[] = [];
    const pending = deferred.promise.then((value) => values.push(value));
    deferred.resolve(7);
    await pending;
    expect(values).toEqual([7]);
  });
});
