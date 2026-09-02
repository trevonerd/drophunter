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
  options: {
    readonly favoriteEndsAt?: string;
    readonly manual?: boolean;
    readonly queue?: readonly TwitchGame[];
    readonly running?: TwitchGame;
  } = {},
) {
  const manual = campaign('manual', '2030-08-04T12:00:00.000Z');
  const favorite = campaign('favorite', options.favoriteEndsAt ?? '2030-08-03T12:00:00.000Z');
  const manualDrop = reward(manual);
  const favoriteDrop = reward(favorite);
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [manual, favorite],
    drops: [manualDrop, favoriteDrop],
    campaignDropsByKey: {
      [gameKey(manual)]: [manualDrop],
      [gameKey(favorite)]: [favoriteDrop],
    },
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.campaignPriorityMode = mode;
  state.appState.favoriteGames = [{ gameId: favorite.id, lastKnownName: favorite.name, addedAt: 1 }];
  state.appState.isRunning = options.running !== undefined;
  state.appState.selectedGame = options.running ?? null;
  state.appState.queue = [...(options.queue ?? [manual])];
  state.appState.queueEntryMetadataByKey = Object.fromEntries(
    state.appState.queue.map((game) => [
      gameKey(game),
      { source: 'manual' as const, addedAt: 1, reason: 'user-added' as const },
    ]),
  );
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => undefined,
  });
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async (target) => ({
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
    }),
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
  test.each([
    {
      favoriteEndsAt: '2030-08-03T12:00:00.000Z',
      selected: 'campaign:campaign-favorite',
      queue: ['campaign:campaign-favorite', 'campaign:campaign-manual'],
    },
    {
      favoriteEndsAt: '2030-08-05T12:00:00.000Z',
      selected: 'campaign:campaign-manual',
      queue: ['campaign:campaign-manual', 'campaign:campaign-favorite'],
    },
  ])('starts the correct campaign immediately according to expiry when idle', async (scenario) => {
    // Given: an idle extension with one manual campaign and one discovered favorite.
    const subject = fixture('priority-list-only', { favoriteEndsAt: scenario.favoriteEndsAt });

    // When: the public automation request reconciles the queue.
    const outcome = await subject.automation.request('campaign-refresh');

    // Then: farming starts immediately from the earlier campaign and leaves the other queued.
    expect({
      outcome,
      selected: subject.state.appState.selectedGame ? gameKey(subject.state.appState.selectedGame) : null,
      queue: subject.state.appState.queue.map(gameKey),
    }).toEqual({
      outcome: { kind: 'started', campaignKey: scenario.selected, transition: 'start' },
      selected: scenario.selected,
      queue: scenario.queue,
    });
  });

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
    ['between', '2030-08-02T12:00:00.000Z'],
    ['after equal expiry', '2030-08-03T12:00:00.000Z'],
  ] as const)('inserts a favorite %s without duplicates while farming', async (_label, firstEndsAt) => {
    const running = campaign('running', '2030-08-01T12:00:00.000Z');
    const first = campaign('first', firstEndsAt);
    const last = campaign('last', '2030-08-04T12:00:00.000Z');
    const subject = fixture('priority-list-only', { queue: [first, last], running });

    const outcomes = [
      await subject.automation.request('campaign-refresh'),
      await subject.automation.request('periodic'),
    ];

    expect({
      outcomes,
      queue: subject.state.appState.queue.map(gameKey),
      selected: subject.state.appState.selectedGame,
    }).toEqual({
      outcomes: [
        { kind: 'unchanged', reason: 'already-farming-best-campaign' },
        { kind: 'unchanged', reason: 'already-farming-best-campaign' },
      ],
      queue: [gameKey(first), gameKey(subject.favorite), gameKey(last)],
      selected: running,
    });
  });
});
