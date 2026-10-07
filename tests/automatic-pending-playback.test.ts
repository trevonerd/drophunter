import { expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { deriveSafeRefreshPatch } from '../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchHealth } from '../src/background/watch-health.ts';
import { createWatchTransportCoordinator } from '../src/background/watch-transport-coordinator.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';

function fixture(previousFailures: string[] = []) {
  let now = 1_000;
  let phase: 'pending' | 'unknown' | 'ready' = 'pending';
  const campaign = createGame({
    campaignId: 'cold-campaign',
    categorySlug: 'cold-game',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const drop = createDrop({ campaignId: campaign.campaignId, gameId: campaign.id, requiredMinutes: 60 });
  const unrelated = createDrop({ id: 'unrelated', campaignId: 'other-campaign', gameId: 'other-game' });
  const key = gameKey(campaign);
  const state = createServiceWorkerState();
  state.appState.watchTransportPreference = 'managed-tab';
  state.appState.autoStartFavoriteGames = true;
  state.appState.selectedGame = null;
  state.appState.queue = [campaign];
  state.appState.queueEntryMetadataByKey[key] = {
    source: 'favorite-auto',
    addedAt: now,
    reason: 'favorite-discovered',
    attemptedStreamerNames: previousFailures,
  };
  state.appState.favoriteGames = [{ gameId: campaign.id, lastKnownName: campaign.name, addedAt: now }];
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => {},
  });
  const retainedPage = { id: 23, suspended: false, disposals: 0, suspensions: 0 };
  const runtime = createWatchTransportCoordinator({
    state,
    heartbeat: async () => ({ accepted: true }),
    managedTab: {
      open: async (target) =>
        phase === 'unknown'
          ? null
          : {
              owner: 'drophunter',
              tabId: retainedPage.id,
              ownership: {
                kind: 'managed-tab',
                tabId: retainedPage.id,
                ownershipToken: 'cold-watch',
                expectedChannel: target.channelName,
              },
              health: createWatchHealth(
                'managed-tab',
                phase === 'ready' ? 'healthy' : 'failed',
                phase === 'ready' ? 'heartbeat' : 'playback-pending',
                () => now,
              ),
              dispose: async () => {
                retainedPage.disposals++;
                retainedPage.suspended = true;
              },
            },
      probe: async () => ({ accepted: true }),
      pauseRetained: async (isCurrent) => {
        if (!isCurrent?.()) return;
        retainedPage.suspensions++;
        retainedPage.suspended = true;
      },
      close: async () => {},
    },
    persist: async () => {},
    broadcast: () => {},
    now: () => now,
  });
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    runtime,
    prepareManaged: async () => null,
    prepareTabless: async () => null,
    release: async () => ({ kind: 'not-required' }),
  });
  const notifications: string[] = [];
  const alarms: number[] = [];
  const snapshot = {
    games: [campaign],
    drops: [drop, unrelated],
    campaignDropsByKey: { [key]: [drop] },
    campaignChannelsMap: {},
    updatedAt: now,
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
    browser: {
      watch,
      hasNotificationPermission: async () => true,
      deliverNotification: async ({ id }) => ({ kind: 'delivered', notificationId: id }),
      observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
      replaceDeadlineAlarm: async (at) => {
        if (at !== null) alarms.push(at);
        return 'scheduled';
      },
      schedulePeriodicAlarm: async () => 'scheduled',
    },
    automationNotify: {
      notify: async (notification) => {
        notifications.push(notification.message);
      },
    },
    twitch: {
      refresh: async () => ({
        kind: 'ready',
        snapshot: { ...snapshot, updatedAt: now },
        refreshPatch: deriveSafeRefreshPatch(snapshot),
      }),
      fetchDirectory: async () => ({
        kind: 'ready',
        target: {
          campaignKey: key,
          campaignId: campaign.campaignId ?? null,
          gameId: campaign.id,
          gameName: campaign.name,
          categoryId: null,
          categorySlug: campaign.categorySlug ?? '',
        },
        streamers: [createStreamer({ name: 'cold_channel' })],
        languageFilterApplied: false,
      }),
    },
    now: () => now,
    random: () => 0,
  });
  return {
    state,
    campaign,
    key,
    drop,
    unrelated,
    persistence,
    retainedPage,
    notifications,
    alarms,
    request: () => automation.request('periodic'),
    retry: () => {
      now = (state.appState.nextAutomationCheckAt ?? now) + 1;
    },
    setNow: (value: number) => {
      now = value;
    },
    setPhase: (value: typeof phase) => {
      phase = value;
    },
  };
}

test('automatic cold playback commits the retained channel when it becomes ready without self-superseding', async () => {
  const subject = fixture();
  expect(await subject.request()).toMatchObject({ kind: 'failed', reason: 'candidate-playback-pending' });
  expect(subject.state.appState.queueEntryMetadataByKey[subject.key]?.watchAttempt?.preparing).toBe(true);
  expect(subject.retainedPage.disposals).toBe(0);
  subject.retry();
  subject.setPhase('ready');
  expect(await subject.request()).toMatchObject({ kind: 'started' });
  expect(subject.state.appState.activeStreamer?.name).toBe('cold_channel');
  expect(subject.state.appState.tabId).toBe(subject.retainedPage.id);
  expect(
    subject.state.appState.queueEntryMetadataByKey[subject.key]?.watchAttempt?.preparing,
  ).toBeUndefined();
  expect(subject.retainedPage.disposals).toBe(0);
  expect((await subject.persistence.loadReceipt()).kind).toBe('ready');
});

test('unavailable ownership after loading preserves its reservation and real retries beyond the observation deadline', async () => {
  const subject = fixture(['failed-1', 'failed-2', 'failed-3']);
  expect(await subject.request()).toMatchObject({ reason: 'candidate-playback-pending' });
  const observation = subject.state.appState.queueEntryMetadataByKey[subject.key]?.watchAttempt?.observedAt;
  subject.setPhase('unknown');
  subject.setNow(600_001);
  expect(await subject.request()).toMatchObject({ reason: 'candidate-playback-pending' });
  const metadata = subject.state.appState.queueEntryMetadataByKey[subject.key];
  expect(metadata?.watchAttempt).toMatchObject({ preparing: true, observedAt: observation });
  expect(metadata?.streamerRetryReason).toBeUndefined();
  expect(subject.state.appState.campaignFailureEpisodesByKey).toEqual({});
  expect(subject.notifications).toEqual([]);
  expect(subject.retainedPage.suspensions).toBe(0);
  const retryAt = subject.state.appState.nextAutomationCheckAt;
  if (retryAt === null) throw new Error('Expected a real loading retry');
  expect(subject.alarms).toContain(retryAt);
  subject.retry();
  subject.setPhase('ready');
  expect(await subject.request()).toMatchObject({ kind: 'started' });
});

test('verified loading past its observation deadline suspends the retained page and keeps genuine failure evidence', async () => {
  const subject = fixture();
  expect(await subject.request()).toMatchObject({ reason: 'candidate-playback-pending' });
  subject.unrelated.progress = 60;
  subject.setNow(301_001);
  expect(await subject.request()).toMatchObject({ kind: 'failed', reason: 'candidate-preparation-failed' });
  expect(subject.retainedPage.suspended).toBe(true);
  expect(subject.retainedPage.suspensions).toBe(1);
  expect(subject.state.appState.watchHealth?.reason).toBe('stopped');
  expect(subject.state.appState.pendingWatchTarget).toBeNull();
  expect(
    subject.state.appState.queueEntryMetadataByKey[subject.key]?.watchAttempt?.preparing,
  ).toBeUndefined();
  expect(subject.state.appState.queueEntryMetadataByKey[subject.key]?.attemptedStreamerNames).toEqual([
    'cold_channel',
  ]);
  expect(subject.notifications).toEqual([]);
});

test('authoritative progress for the loading campaign renews observation before declaring failure', async () => {
  const subject = fixture();
  expect(await subject.request()).toMatchObject({ reason: 'candidate-playback-pending' });
  subject.drop.progress = 30;
  subject.setNow(301_001);
  expect(await subject.request()).toMatchObject({ reason: 'candidate-playback-pending' });
  expect(subject.state.appState.queueEntryMetadataByKey[subject.key]?.watchAttempt).toMatchObject({
    preparing: true,
    observedAt: 301_001,
    preparationProgress: 30,
  });
  expect(subject.retainedPage.suspensions).toBe(0);
});
