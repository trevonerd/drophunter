import { expect, test } from 'bun:test';
import { createAutomationEventNotifier } from '../../src/background/automation-event-notifier.ts';
import { prepareBrowserSessionResume } from '../../src/background/browser-session-resume.ts';
import { recordCampaignFailure } from '../../src/background/campaign-failure-episodes.ts';
import { dismissFarmingMessage } from '../../src/background/dismiss-farming-message.ts';
import {
  QUEUE_ROUND_RETRY_MS,
  restartQueueAcquisitionRound,
} from '../../src/background/queue-acquisition-round.ts';
import { saveState } from '../../src/background/state-persistence.ts';
import { beginStreamerWatchAttempt } from '../../src/background/streamer-watch-attempt.ts';
import { normalizeStoredAppState } from '../../src/shared/app-state-sync.ts';
import { farmingMessages } from '../../src/shared/farming-messages.ts';
import { createMinimalState } from '../fixtures/queue-management.ts';
import { chrome, fixture, NOW } from '../support/farming-cycle-contract.ts';
import { required } from '../support/required.ts';

test('failure episodes persist across rounds; delivery receipts remain independent', async () => {
  const { state, game, key } = fixture();
  for (const name of ['a', 'b', 'c', 'd']) beginStreamerWatchAttempt(state, game, name);
  const seen = new Set<string>();
  let browser = 0;
  let telegram = 0;
  let reject = true;
  const notifier = createAutomationEventNotifier({
    notifyBrowser: async () => {
      browser++;
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async () => {
      telegram++;
      if (reject) throw new Error('Telegram unavailable');
      return true;
    },
    persistence: {
      hasSeen: (id) => seen.has(id),
      markSeen: (id) => {
        seen.add(id);
      },
    },
  });
  const initial = required(recordCampaignFailure(state, game, 'stalled-progress'));
  await notifier.notify(initial);
  await dismissFarmingMessage(state, initial.transitionId, () => saveState(state));
  const restored = createMinimalState();
  restored.appState = normalizeStoredAppState(
    JSON.parse(JSON.stringify(chrome.storage.local._store.get('appState'))),
  );
  restartQueueAcquisitionRound(restored);
  for (const name of ['a', 'b', 'c', 'd']) beginStreamerWatchAttempt(restored, game, name);
  const next = required(recordCampaignFailure(restored, game, 'open-failed', NOW + QUEUE_ROUND_RETRY_MS));
  expect(next.transitionId).toBe(initial.transitionId);
  expect(farmingMessages(restored.appState)).toEqual([]);
  expect(restored.appState.campaignFailureEpisodesByKey[key]?.startedAt).toBe(NOW);
  reject = false;
  await notifier.notify(next);
  await notifier.notify(next);
  expect(browser).toBe(1);
  expect(telegram).toBe(2);
  expect(await dismissFarmingMessage(restored, 'invented-id', () => saveState(restored))).toMatchObject({
    success: false,
  });
});

test('new browser session hides old errors without replacing episode IDs, while worker recycle preserves attempts', async () => {
  const { state, game, key } = fixture();
  for (const name of ['a', 'b', 'c', 'd']) beginStreamerWatchAttempt(state, game, name);
  const event = required(recordCampaignFailure(state, game, 'open-failed'));
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'manual',
    reason: 'user-added',
    addedAt: NOW,
    attemptedStreamerNames: ['a', 'b'],
    watchAttempt: { channelName: 'b', observedAt: NOW - 1000 },
  };
  state.appState.queueAcquisitionRound = {
    attemptedCampaignKeys: [key],
    nextRoundAt: NOW + QUEUE_ROUND_RETRY_MS,
  };
  chrome.storage.session._store.set('farmingBrowserSessionSeen', true);
  await prepareBrowserSessionResume(state);
  expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual(['a', 'b']);
  expect(state.appState.queueAcquisitionRound?.nextRoundAt).toBe(NOW + QUEUE_ROUND_RETRY_MS);
  chrome.storage.session._store.clear();
  await prepareBrowserSessionResume(state);
  expect(state.appState.isRunning).toBe(true);
  expect(state.appState.selectedGame).toEqual(game);
  expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toBeUndefined();
  expect(farmingMessages(state.appState)).toEqual([]);
  expect(recordCampaignFailure(state, game, 'stalled-progress')).toBeNull();
  for (const name of ['a', 'b', 'c', 'd']) beginStreamerWatchAttempt(state, game, name);
  expect(required(recordCampaignFailure(state, game, 'stalled-progress')).transitionId).toBe(
    event.transitionId,
  );
  expect(farmingMessages(state.appState)).toHaveLength(1);
});

test('corrupt operational state cannot invent acquisition or override manual Stop', () => {
  const { game, key } = fixture();
  const normalized = normalizeStoredAppState({
    isRunning: true,
    isPaused: true,
    manualQueueAuthorized: true,
    lastStopReason: 'user-stop',
    farmingSessionTargets: { [key]: { game, acquired: true }, bad: { game: null, acquired: true } },
    campaignFailureEpisodesByKey: { bad: { id: 'bad', game, startedAt: NaN, lastAttemptAt: Infinity } },
    dismissedFarmingMessageIds: ['a', 'a', null],
    queueEntryMetadataByKey: {
      [key]: {
        source: 'manual',
        reason: 'user-added',
        addedAt: NOW,
        stalledStreamerNames: [' A ', 'b'],
        failedPlaybackStreamerNames: ['a', 'C', 'd', 'e'],
        watchAttempt: { channelName: 'B', observedAt: Infinity },
      },
    },
  });
  expect(normalized.isRunning).toBe(false);
  expect(normalized.farmingSessionTargets[key]?.acquired).toBe(false);
  expect(normalized.campaignFailureEpisodesByKey).toEqual({});
  expect(normalized.dismissedFarmingMessageIds).toEqual(['a']);
  expect(normalized.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual(['a', 'b', 'c', 'd']);
  expect(normalized.queueEntryMetadataByKey[key]?.watchAttempt).toBeUndefined();
});
