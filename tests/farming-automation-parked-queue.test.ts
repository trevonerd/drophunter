import { describe, expect, test } from 'bun:test';
import { gameKey } from '../src/shared/game-selection.ts';
import { fixture } from './support/farming-automation-queue-fixture.ts';

describe('durable parked queue automation', () => {
  test('legacy suppression retains the queued campaign and expires after one minute', async () => {
    let now = 2_000;
    const subject = fixture('priority-list-only', { now: () => now });
    const key = gameKey(subject.favorite);
    subject.state.appState.queue.push(subject.favorite);
    subject.state.appState.queueEntryMetadataByKey[key] = {
      source: 'favorite-auto',
      addedAt: 1,
      reason: 'favorite-discovered',
    };
    expect(await subject.automation.suppressCampaignUntilRefresh(key)).toBe('suppressed');
    expect(await subject.automation.request('periodic')).toEqual({
      kind: 'unchanged',
      reason: 'no-eligible-campaign',
    });
    expect(subject.state.appState.queue.map(gameKey)).toContain(key);
    now = 62_000;
    expect(await subject.automation.request('periodic')).toEqual({
      kind: 'started',
      campaignKey: key,
      transition: 'start',
    });
  });

  test('retains a parked favorite until its short retry deadline', async () => {
    let now = 2_000;
    const subject = fixture('priority-list-only', { now: () => now });
    const key = gameKey(subject.favorite);
    subject.state.appState.queue.push(subject.favorite);
    subject.state.appState.queueEntryMetadataByKey[key] = {
      source: 'favorite-auto',
      addedAt: 1,
      reason: 'favorite-discovered',
      streamerRetryAt: 62_000,
    };

    expect(await subject.automation.request('periodic')).toEqual({
      kind: 'unchanged',
      reason: 'no-eligible-campaign',
    });
    expect(subject.state.appState.queue.map(gameKey)).toContain(key);
    expect(subject.state.appState.nextAutomationCheckAt).toBe(62_000);
    now = 62_000;
    expect(await subject.automation.request('periodic')).toEqual({
      kind: 'started',
      campaignKey: key,
      transition: 'start',
    });
  });

  test.each([false, true])('parked manual queue requires authorization: %s', async (authorized) => {
    const subject = fixture('priority-list-only', { favorite: false });
    const key = gameKey(subject.manual);
    subject.state.appState.autoStartFavoriteGames = false;
    subject.state.appState.manualQueueAuthorized = authorized;
    subject.state.appState.queueEntryMetadataByKey[key] = {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      streamerRetryAt: 1_000,
    };

    expect(await subject.automation.request('periodic')).toEqual(
      authorized
        ? { kind: 'started', campaignKey: key, transition: 'start' }
        : { kind: 'unchanged', reason: 'disabled' },
    );
  });
});
