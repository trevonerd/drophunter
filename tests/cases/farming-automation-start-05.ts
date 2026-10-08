import { describe, expect, test } from 'bun:test';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  type FarmingAutomationFactsV1,
} from '../../src/background/farming-automation-contracts.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import { startFixture } from '../support/farming-automation-start-fixture.ts';

describe('Farming automation start', () => {
  test('keeps a stalled favorite suppressed across failed refreshes and re-enables it after confirmation', async () => {
    let refreshFails = true;
    const subject = startFixture(Promise.resolve(), true, () => refreshFails);
    const campaignKey = gameKey(subject.best);

    const suppressed = await subject.automation.suppressCampaignUntilRefresh(campaignKey);
    const failed = await subject.automation.request('periodic');
    const factsAfterFailure = subject.storage.getLocal(
      FARMING_AUTOMATION_FACTS_STORAGE_KEY,
    ) as FarmingAutomationFactsV1;

    expect(suppressed).toBe('suppressed');
    expect(failed).toEqual({ kind: 'failed', reason: 'drops-refresh-failed', retryAt: 122_000 });
    expect(factsAfterFailure.suppressedCampaignKeys).toEqual([campaignKey]);
    expect(subject.state.appState.favoriteGames).toHaveLength(1);
    expect(subject.state.appState.isRunning).toBe(false);

    refreshFails = false;
    subject.setNow(302_000);
    const confirmed = await subject.automation.request('periodic');
    const factsAfterSuccess = subject.storage.getLocal(
      FARMING_AUTOMATION_FACTS_STORAGE_KEY,
    ) as FarmingAutomationFactsV1;

    expect(confirmed).toEqual({ kind: 'started', campaignKey, transition: 'start' });
    expect(factsAfterSuccess.suppressedCampaignKeys).toEqual([]);
  });
});
