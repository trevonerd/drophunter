import type { AutomationEventNotifier } from '../../src/background/automation-event-notifier.ts';
import { createFarmingAutomation } from '../../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../../src/background/farming-automation-browser.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../../src/background/farming-automation-persistence.ts';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchAdapter,
  type FarmingAutomationTwitchSnapshot,
} from '../../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../../src/background/farming-session-revision.ts';
import { observeManualPlayback } from '../../src/background/playback-orchestrator.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../../src/background/watch-transport-transition.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import type { CampaignPriorityMode, TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

export function campaign(id: string, endsAt: string): TwitchGame {
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

export interface QueueFixtureOptions {
  readonly now?: () => number;
  readonly onPrepare?: () => void;
  readonly twitch?: FarmingAutomationTwitchAdapter;
  readonly automationNotify?: AutomationEventNotifier;
  readonly favoriteEndsAt?: string;
  readonly favorite?: boolean;
  readonly favoriteGame?: 'favorite' | 'manual';
  readonly manual?: boolean;
  readonly dropsPageOpen?: boolean;
  readonly queue?: readonly TwitchGame[];
  readonly running?: TwitchGame;
}

export function fixture(mode: CampaignPriorityMode, options: QueueFixtureOptions = {}) {
  const manual = campaign('manual', '2030-08-04T12:00:00.000Z');
  const favorite = campaign('favorite', options.favoriteEndsAt ?? '2030-08-03T12:00:00.000Z');
  const hasFavorite = options.favorite !== false;
  const manualDrop = reward(manual);
  const favoriteDrop = reward(favorite);
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: hasFavorite ? [manual, favorite] : [manual],
    drops: hasFavorite ? [manualDrop, favoriteDrop] : [manualDrop],
    campaignDropsByKey: {
      [gameKey(manual)]: [manualDrop],
      ...(hasFavorite ? { [gameKey(favorite)]: [favoriteDrop] } : {}),
    },
    campaignChannelsMap: {},
    updatedAt: 1_000,
  };
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.campaignPriorityMode = mode;
  state.appState.favoriteGames = hasFavorite
    ? [
        options.favoriteGame === 'manual'
          ? { gameId: manual.id, lastKnownName: manual.name, addedAt: 1 }
          : { gameId: favorite.id, lastKnownName: favorite.name, addedAt: 1 },
      ]
    : [];
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
    prepareManaged: async (target) => {
      options.onPrepare?.();
      return {
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
      };
    },
    prepareTabless: async () => null,
    release: async () => ({ kind: 'not-required' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async ({ id }) => ({ kind: 'delivered', notificationId: id }),
    observeManualTabs: async () =>
      options.dropsPageOpen
        ? observeManualPlayback(
            { query: async () => [{ id: 90, active: false, url: 'https://www.twitch.tv/drops/campaigns' }] },
            async () => {
              throw new DOMException('Drops is not a stream and must not be inspected', 'InvariantError');
            },
          )
        : {
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
          },
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
    automationNotify: options.automationNotify,
    twitch: options.twitch ?? {
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
    now: options.now ?? (() => 2_000),
    random: () => 0,
  });
  return { automation, favorite, manual, state, storage };
}
