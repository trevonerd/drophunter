import { expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import type { FarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createFarmingAutomationTwitchAdapter } from '../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame, TwitchSession } from '../src/types/index.ts';

const session: TwitchSession = {
  oauthToken: 'oauth-token',
  userId: 'viewer',
  deviceId: 'device',
  uuid: 'uuid',
};

function campaign(campaignId: string, endsAt: string): TwitchGame {
  return {
    id: 'marvel-rivals',
    name: 'Marvel Rivals',
    imageUrl: '',
    categoryId: 'marvel-rivals',
    campaignId,
    campaignName: campaignId,
    dropCount: 1,
    endsAt,
  };
}

function reward(
  campaignId: string,
  acquisitionMethod: TwitchDrop['acquisitionMethod'],
  claimed = false,
): TwitchDrop {
  return {
    id: `reward-${campaignId}`,
    name: campaignId,
    gameId: 'marvel-rivals',
    gameName: 'Marvel Rivals',
    imageUrl: '',
    progress: claimed ? 100 : 0,
    currentMinutes: claimed ? 60 : 0,
    claimed,
    campaignId,
    acquisitionMethod,
    rewardKind: 'in-game',
    verificationState: claimed ? 'verified' : 'unassessed',
  };
}

test('campaign refresh persists the first farmable favorite immediately', async () => {
  // Given: Marvel campaigns where the earliest is acquired, the next is subscription-only, and Season 9.5 is pending.
  const acquired = campaign('ignite-day-1', '2030-08-01T00:00:00.000Z');
  const subscription = campaign('subscription-token', '2030-08-02T00:00:00.000Z');
  const season = campaign('season-9-5', '2030-08-03T00:00:00.000Z');
  const campaignSnapshot: DropsSnapshot = {
    games: [acquired, subscription, season],
    drops: [
      reward('ignite-day-1', 'watch-time'),
      reward('subscription-token', 'subscription'),
      reward('season-9-5', 'watch-time'),
    ],
    updatedAt: 1_000,
  };
  const inventorySnapshot: DropsSnapshot = {
    games: [acquired],
    drops: [reward('ignite-day-1', 'watch-time', true)],
    updatedAt: 1_500,
  };
  const directoryRequests: string[] = [];
  const twitch = createFarmingAutomationTwitchAdapter({
    loadSession: async () => session,
    fetchCampaignSnapshot: async () => campaignSnapshot,
    fetchInventorySnapshot: async () => inventorySnapshot,
    fetchDirectoryStreamers: async (game) => {
      directoryRequests.push(game.campaignId ?? 'missing');
      return {
        streamers: [{ id: 'streamer', name: 'streamer', displayName: 'Streamer', isLive: true }],
        languageFilterApplied: false,
      };
    },
  });
  const state = createServiceWorkerState();
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.campaignPriorityMode = 'priority-list-only';
  state.appState.favoriteGames = [{ gameId: 'marvel-rivals', lastKnownName: 'Marvel Rivals', addedAt: 1 }];
  const storage = createInMemoryFarmingAutomationStorage();
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
    broadcast: () => undefined,
  });
  const watch = createWatchTransportTransition({
    currentOwnership: null,
    prepareManaged: async () => null,
    prepareTabless: async () => null,
    release: async () => ({ kind: 'not-required' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async ({ id }) => ({ kind: 'delivered', notificationId: id }),
    observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
    replaceDeadlineAlarm: async () => 'scheduled',
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    twitch,
    manualWatch: {
      evaluate: async () => ({
        kind: 'active',
        watch: {
          kind: 'eligible-manual',
          observedAt: 2_000,
          expiresAt: 22_000,
          recheckAt: 22_000,
        },
      }),
      reconcileTransport: async () => 'unchanged',
    },
    now: () => 2_000,
    random: () => 0,
  });

  // When: the completed Twitch refresh triggers one public campaign-refresh evaluation.
  const outcome = await automation.request('campaign-refresh');

  // Then: Season 9.5 is already the only automatic queue entry before the request resolves.
  expect({
    outcome,
    directoryRequests,
    queue: state.appState.queue.map(gameKey),
    metadata: state.appState.queueEntryMetadataByKey,
    stored: storage.getLocal('appState'),
  }).toEqual({
    outcome: { kind: 'unchanged', reason: 'manual-watch-active' },
    directoryRequests: ['season-9-5'],
    queue: [gameKey(season)],
    metadata: {
      [gameKey(season)]: {
        source: 'favorite-auto',
        addedAt: 2_000,
        reason: 'favorite-discovered',
      },
    },
    stored: expect.objectContaining({
      queue: [expect.objectContaining({ campaignId: 'season-9-5' })],
    }),
  });
});
