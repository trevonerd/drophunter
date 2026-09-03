import { describe, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../../src/background/farming-automation-browser.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../../src/background/farming-automation-persistence.ts';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchSnapshot,
} from '../../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../../src/background/watch-transport-transition.ts';
import { gameKey } from '../../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../../src/types/index.ts';

describe('Farming automation start', () => {
  test('keeps a manually queued non-favorite idle until explicit start', async () => {
    const manual: TwitchGame = {
      id: 'manual-game',
      name: 'Manual Game',
      imageUrl: '',
      campaignId: 'manual-campaign',
      categorySlug: 'manual-game',
      endsAt: '2030-08-03T12:00:00.000Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    };
    const drop: TwitchDrop = {
      id: 'manual-drop',
      name: 'Manual Reward',
      gameId: manual.id,
      gameName: manual.name,
      imageUrl: '',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      campaignId: manual.campaignId,
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    };
    const snapshot: FarmingAutomationTwitchSnapshot = {
      games: [manual],
      drops: [drop],
      campaignDropsByKey: { [gameKey(manual)]: [drop] },
      campaignChannelsMap: {},
      updatedAt: 1_000,
    };
    const state = createServiceWorkerState();
    state.appState.autoStartFavoriteGames = true;
    state.appState.notificationsEnabled = true;
    state.appState.campaignPriorityMode = 'priority-list-only';
    state.appState.queue = [manual];
    state.appState.queueEntryMetadataByKey = {
      [gameKey(manual)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
    };
    const persistence = createInMemoryFarmingAutomationPersistence({
      state,
      storage: createInMemoryFarmingAutomationStorage(),
      getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
      broadcast: () => undefined,
    });
    const watch = createWatchTransportTransition({
      currentOwnership: null,
      prepareManaged: async (target) => ({
        target,
        ownership: {
          kind: 'managed-tab',
          tabId: 22,
          ownershipToken: 'manual-test',
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
      release: async () => ({ kind: 'released', method: 'closed' }),
    });
    const notifications: string[] = [];
    const telegramAlerts: string[] = [];
    const browser: FarmingAutomationBrowser = {
      watch,
      hasNotificationPermission: async () => true,
      deliverNotification: async (notification) => {
        notifications.push(notification.message);
        return { kind: 'delivered', notificationId: notification.id };
      },
      observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
      replaceDeadlineAlarm: async () => 'scheduled',
      schedulePeriodicAlarm: async () => 'scheduled',
    };
    const streamer: TwitchStreamer = {
      id: 'streamer',
      name: 'manual-channel',
      displayName: 'Manual Channel',
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
            categoryId: game.categoryId ?? null,
            categorySlug: game.categorySlug ?? game.name,
          },
          streamers: [streamer],
          languageFilterApplied: false,
        }),
      },
      now: () => 2_000,
      random: () => 0,
      telegramNotify: async (_reason, message) => {
        telegramAlerts.push(message);
      },
    });

    const outcome = await automation.request('campaign-refresh');

    expect({
      outcome,
      isRunning: state.appState.isRunning,
      selectedGame: state.appState.selectedGame,
      queue: state.appState.queue.map(gameKey),
      notifications,
      telegramAlerts,
    }).toEqual({
      outcome: { kind: 'unchanged', reason: 'no-eligible-campaign' },
      isRunning: false,
      selectedGame: null,
      queue: [gameKey(manual)],
      notifications: [],
      telegramAlerts: [],
    });
  });
});
