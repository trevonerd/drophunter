import { expect, test } from 'bun:test';
import { createAutomationEventNotifier } from '../src/background/automation-event-notifier.ts';
import { recordCampaignFailure } from '../src/background/campaign-failure-episodes.ts';
import { beginStreamerWatchAttempt } from '../src/background/streamer-watch-attempt.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { farmingMessages } from '../src/shared/farming-messages.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';
import { required } from './support/required.ts';

test('campaign warnings wait for four distinct attempts, preserving a single failure episode', () => {
  const state = createMinimalState();
  const game = createGame();
  for (const name of ['one', 'two', 'three']) {
    expect(beginStreamerWatchAttempt(state, game, name)).toBe(true);
    expect(recordCampaignFailure(state, game, 'open-failed')).toBeNull();
    expect(farmingMessages(state.appState)).toEqual([]);
  }
  expect(beginStreamerWatchAttempt(state, game, 'four')).toBe(true);
  const event = recordCampaignFailure(state, game, 'stalled-progress');
  expect(event?.event).toBe('recovery');
  expect(farmingMessages(state.appState)).toHaveLength(1);
  expect(recordCampaignFailure(state, game, 'open-failed')?.transitionId).toBe(event?.transitionId);
});

test('duplicate channel spellings cannot satisfy the four-attempt alert threshold', () => {
  const state = createMinimalState();
  const game = createGame();
  state.appState.queueEntryMetadataByKey[gameKey(game)] = {
    source: 'manual',
    addedAt: 1,
    reason: 'user-added',
    attemptedStreamerNames: ['one', ' ONE ', 'two', 'three'],
  };
  expect(recordCampaignFailure(state, game, 'open-failed')).toBeNull();
  expect(farmingMessages(state.appState)).toEqual([]);
});

test('worker restoration hides legacy unqualified episodes and preserves proved exhaustion', () => {
  const state = createMinimalState();
  const game = createGame({ campaignId: 'threshold' });
  const key = gameKey(game);
  const episode = {
    id: 'campaign-failure:legacy',
    game,
    reason: 'open-failed',
    startedAt: 1,
    lastAttemptAt: 2,
    visible: true,
  };
  state.appState.campaignFailureEpisodesByKey[key] = episode;
  expect(farmingMessages(normalizeStoredAppState(structuredClone(state.appState)))).toEqual([]);
  for (const name of ['a', 'b', 'c', 'd']) beginStreamerWatchAttempt(state, game, name);
  recordCampaignFailure(state, game, 'open-failed');
  const restored = normalizeStoredAppState(structuredClone(state.appState));
  expect(restored.campaignFailureEpisodesByKey[key]?.exhausted).toBe(true);
  expect(farmingMessages(restored)).toHaveLength(1);
});

test('first qualified exhaustion bypasses legacy notification receipts and later rounds stay deduplicated', async () => {
  const state = createMinimalState();
  const game = createGame({ campaignId: 'legacy-receipt' });
  const key = gameKey(game);
  const legacyId = 'campaign-failure:legacy-receipt';
  state.appState.campaignFailureEpisodesByKey[key] = {
    id: legacyId,
    game,
    reason: 'open-failed',
    startedAt: 1,
    lastAttemptAt: 2,
    visible: true,
  };
  state.appState = normalizeStoredAppState(structuredClone(state.appState));
  expect(state.appState.campaignFailureEpisodesByKey[key]?.id).toBe(legacyId);
  const receipts = new Set([`browser:${legacyId}`, `telegram:${legacyId}`]);
  let browserDeliveries = 0;
  let telegramDeliveries = 0;
  const notifier = createAutomationEventNotifier({
    persistence: {
      hasSeen: (id) => receipts.has(id),
      markSeen: (id) => {
        receipts.add(id);
      },
    },
    notifyBrowser: async () => {
      browserDeliveries++;
      return { shown: true, deduplicated: false };
    },
    notifyTelegram: async () => {
      telegramDeliveries++;
      return true;
    },
  });
  for (const name of ['a', 'b', 'c', 'd']) beginStreamerWatchAttempt(state, game, name);
  const first = required(recordCampaignFailure(state, game, 'open-failed', 10));
  expect(first.transitionId).not.toBe(legacyId);
  expect(state.appState.campaignFailureEpisodesByKey[key]?.startedAt).toBe(10);
  await notifier.notify(first);
  const repeated = required(recordCampaignFailure(state, game, 'stalled-progress', 20));
  expect(repeated.transitionId).toBe(first.transitionId);
  expect(state.appState.campaignFailureEpisodesByKey[key]?.startedAt).toBe(10);
  await notifier.notify(repeated);
  expect(browserDeliveries).toBe(1);
  expect(telegramDeliveries).toBe(1);
});
