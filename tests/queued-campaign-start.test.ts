import { describe, expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { campaign, fixture } from './support/farming-automation-queue-fixture.ts';

describe('start a specific queued campaign', () => {
  test('a successful start moves the chosen campaign to the head and protects it from favorite preemption', async () => {
    const subject = fixture('priority-list-only', {
      favoriteEndsAt: '2030-08-02T12:00:00.000Z',
      queue: [campaign('manual', '2030-08-04T12:00:00.000Z')],
    });
    const started = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    const automatic = await subject.automation.request('campaign-refresh');
    expect(started).toEqual({ success: true });
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.manual.campaignId);
    expect(subject.state.appState.queue[0]?.campaignId).toBe(subject.manual.campaignId);
    expect(subject.state.appState.forcedCampaignKey).toBe(gameKey(subject.manual));
    expect(subject.state.appState.farmingSessionOrigin).toBe('manual');
    expect(automatic).toEqual({ kind: 'unchanged', reason: 'already-farming-best-campaign' });
    expect(normalizeStoredAppState(structuredClone(subject.state.appState)).forcedCampaignKey).toBe(
      gameKey(subject.manual),
    );
  });

  test('rejects a campaign that is not in the queue, including a different campaign of the same game', async () => {
    const subject = fixture('ending-soonest', { favorite: false });
    const other = { ...subject.manual, campaignId: 'campaign-other' };
    expect(await subject.automation.startQueuedCampaign?.(gameKey(other))).toEqual({
      success: false,
      error: 'Campaign is no longer in the queue.',
    });
    expect(subject.state.appState.selectedGame).toBeNull();
  });

  test('keeps the incumbent when the requested campaign has no eligible streamer', async () => {
    const incumbent = campaign('favorite', '2030-08-02T12:00:00.000Z');
    const subject = fixture('ending-soonest', {
      running: incumbent,
      queue: [incumbent, campaign('manual', '2030-08-04T12:00:00.000Z')],
      eligibleStreamers: [],
    });
    const before = structuredClone(subject.state.appState);
    const result = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    expect(result).toEqual({
      success: false,
      error: 'No eligible streamer is available for this campaign.',
    });
    expect(subject.state.appState).toEqual(before);
  });

  test('a failed preparation leaves the previous selection and queue untouched', async () => {
    const incumbent = campaign('favorite', '2030-08-02T12:00:00.000Z');
    const subject = fixture('ending-soonest', {
      running: incumbent,
      queue: [incumbent, campaign('manual', '2030-08-04T12:00:00.000Z')],
      onPrepare: () => {
        throw new Error('Playback unavailable');
      },
    });
    const before = structuredClone(subject.state.appState);
    const result = await subject.automation.startQueuedCampaign?.(gameKey(subject.manual));
    expect(result?.success).toBe(false);
    expect(subject.state.appState).toEqual(before);
  });

  test('concurrent commands allow only the latest start to commit', async () => {
    let prepares = 0;
    const subject = fixture('ending-soonest', {
      onPrepare: () => {
        prepares += 1;
      },
    });
    const key = gameKey(subject.manual);
    const results = await Promise.all([
      subject.automation.startQueuedCampaign?.(key),
      subject.automation.startQueuedCampaign?.(key),
    ]);
    expect(results.filter((result) => result?.success)).toHaveLength(1);
    expect(prepares).toBe(1);
    expect(subject.state.appState.selectedGame?.campaignId).toBe(subject.manual.campaignId);
  });
});
