import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { CampaignPriorityMode, TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';

function campaign(id: string, endsAt: string): TwitchGame {
  return {
    id,
    name: id,
    imageUrl: '',
    campaignId: `campaign-${id}`,
    categorySlug: id,
    endsAt,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  };
}

function reward(game: TwitchGame): TwitchDrop {
  return {
    id: `drop-${game.id}`,
    name: 'Reward',
    gameId: game.id,
    gameName: game.name,
    imageUrl: '',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    campaignId: game.campaignId,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

function fixture(
  mode: CampaignPriorityMode,
  options: { readonly manual?: boolean; readonly preparationFails?: boolean } = {},
) {
  const manual = campaign('manual', '2030-08-04T12:00:00.000Z');
  const favorite = campaign('favorite', '2030-08-03T12:00:00.000Z');
  const drop = reward(favorite);
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [favorite],
    drops: [drop],
    campaignDropsByKey: { [gameKey(favorite)]: [drop] },
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.campaignPriorityMode = mode;
  state.appState.favoriteGames = [{ gameId: favorite.id, lastKnownName: favorite.name, addedAt: 1 }];
  state.appState.queue = [manual];
  state.appState.queueEntryMetadataByKey = {
    [gameKey(manual)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
  };
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => undefined,
  });
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async (target) =>
      options.preparationFails
        ? null
        : {
            target,
            ownership: {
              kind: 'managed-tab',
              tabId: 2,
              ownershipToken: 'owned',
              expectedChannel: target.channelName,
            },
            health: {
              mode: 'managed-tab',
              isHealthy: true,
              status: 'healthy',
              reason: 'heartbeat',
              consecutiveFailures: 0,
              consecutiveStalls: 0,
              progress: 0,
              shouldFallback: false,
              checkedAt: 1,
            },
            dispose: async () => undefined,
          },
    prepareTabless: async () => null,
    release: async () => ({ kind: 'not-required' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async ({ id }) => ({ kind: 'delivered', notificationId: id }),
    observeManualTabs: async () => ({
      kind: 'observed',
      tabs: options.manual
        ? [
            {
              tab: { id: 91, active: true, url: 'https://www.twitch.tv/manual-channel' },
              context: {
                channelName: 'manual-channel',
                categorySlug: favorite.categorySlug,
                isLive: true,
                isPlaybackReady: true,
                hasDropsSignal: true,
              },
            },
          ]
        : [],
    }),
    replaceDeadlineAlarm: async () => 'scheduled',
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const streamer: TwitchStreamer = {
    id: 'streamer',
    name: 'channel',
    displayName: 'Channel',
    isLive: true,
    viewerCount: 1,
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    twitch: {
      refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
      fetchDirectory: async (game) => ({
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: null,
          categorySlug: game.name,
        },
        streamers: [streamer],
        languageFilterApplied: false,
      }),
    },
    now: () => 2_000,
    random: () => 0,
  });
  return { automation, favorite, manual, state, storage };
}

describe('Farming automation queue policy', () => {
  test('adds favorite-auto queue entries during manual watch without starting', async () => {
    // Given: priority-list-only mode, a manual queue entry, and eligible manual Twitch viewing.
    const subject = fixture('priority-list-only', { manual: true });

    // When: automation discovers the favorite campaign.
    const outcome = await subject.automation.request('periodic');

    // Then: queue discovery persists independently while manual watch blocks selection.
    expect({
      outcome,
      queue: subject.state.appState.queue.map(gameKey),
      metadata: subject.state.appState.queueEntryMetadataByKey,
      activity: subject.state.appState.automationActivity.map(({ kind }) => kind),
      deadline: subject.state.appState.nextAutomationCheckAt,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'manual-watch-active' },
      queue: [gameKey(subject.favorite), gameKey(subject.manual)],
      metadata: {
        [gameKey(subject.manual)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
        [gameKey(subject.favorite)]: {
          source: 'favorite-auto',
          addedAt: 2_000,
          reason: 'favorite-discovered',
        },
      },
      activity: ['favorite-added'],
      deadline: 22_000,
    });
  });

  test.each([
    'ending-soonest',
    'lowest-availability',
  ] as const)('%s mode leaves the visible queue byte-for-byte unchanged', async (mode) => {
    // Given: a private ranking mode with an existing manual queue.
    const subject = fixture(mode);
    const before = structuredClone({
      queue: subject.state.appState.queue,
      metadata: subject.state.appState.queueEntryMetadataByKey,
    });

    // When: automation evaluates a newly discovered favorite.
    await subject.automation.request('periodic');

    // Then: private ranking does not mutate visible queue state.
    expect({
      queue: subject.state.appState.queue,
      metadata: subject.state.appState.queueEntryMetadataByKey,
    }).toEqual(before);
  });

  test('retains an independently persisted queue addition when preparation later fails', async () => {
    // Given: priority-list-only discovery followed by an unavailable candidate watch.
    const subject = fixture('priority-list-only', { preparationFails: true });

    // When: the public request reaches candidate preparation.
    const outcome = await subject.automation.request('periodic');

    // Then: the failure is typed and the already-persisted queue activity remains.
    expect({
      outcome,
      queue: subject.state.appState.queue.map(gameKey),
      activity: subject.state.appState.automationActivity.map(({ kind }) => kind),
    }).toEqual({
      outcome: { kind: 'failed', reason: 'candidate-preparation-failed', retryAt: 122_000 },
      queue: [gameKey(subject.favorite), gameKey(subject.manual)],
      activity: ['favorite-added'],
    });
  });
});
