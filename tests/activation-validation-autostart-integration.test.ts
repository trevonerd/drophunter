import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createActivationSyncCoordinator } from '../src/background/activation-sync-coordinator.ts';
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
import { createFarmingSession } from '../src/background/farming-session.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerActivationSync } from '../src/background/service-worker-activation-sync.ts';
import { createFarmingAutomationUserActionHandlers } from '../src/background/service-worker-runtime-wiring.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let chrome: ReturnType<typeof setupChromeMocks>;
const realNow = Date.now;
let now = 2_000_000;
beforeEach(() => {
  chrome = setupChromeMocks();
  now = 2_000_000;
  Date.now = () => now;
});
afterEach(() => {
  Date.now = realNow;
  chrome.teardown();
});

function fixture(manualAuthorized = true, availableStreamers = true) {
  const state = createServiceWorkerState();
  const skull = createGame({
    id: 'skull',
    name: 'Skull',
    campaignId: 'skull-campaign',
    endsAt: new Date(now + 86_400_000).toISOString(),
  });
  const marvel = createGame({
    id: 'marvel',
    name: 'Marvel',
    campaignId: 'marvel-campaign',
    endsAt: new Date(now + 24 * 86_400_000).toISOString(),
  });
  const drops = [skull, marvel].map((game) =>
    createDrop({ id: `drop-${game.id}`, gameId: game.id, gameName: game.name, campaignId: game.campaignId }),
  );
  for (const game of [skull, marvel]) game.rewardSummary = { completion: 'farmable', remainderReasons: [] };
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [skull, marvel],
    drops,
    updatedAt: now,
    campaignDropsByKey: Object.fromEntries(
      [skull, marvel].map((game) => [gameKey(game), drops.filter((drop) => drop.gameId === game.id)]),
    ),
    campaignChannelsMap: {},
  };
  state.appState.autoStartFavoriteGames = true;
  state.appState.notificationsEnabled = true;
  state.appState.manualQueueAuthorized = manualAuthorized;
  state.appState.farmingSessionOrigin = manualAuthorized ? 'manual' : null;
  state.appState.campaignPriorityMode = 'ending-soonest';
  state.appState.queue = [skull, marvel];
  state.appState.selectedGame = skull;
  state.appState.queueEntryMetadataByKey = {
    [gameKey(skull)]: { source: 'manual', addedAt: now, reason: 'user-added' },
    [gameKey(marvel)]: { source: 'favorite-auto', addedAt: now, reason: 'favorite-discovered' },
  };
  state.appState.favoriteGames = [{ gameId: marvel.id, lastKnownName: marvel.name, addedAt: now }];
  const publishSnapshot = () => {
    state.appState.availableGames = [skull, marvel];
    state.appState.allDrops = drops;
    state.appState.pendingDrops = drops;
    state.appState.currentDrop = drops[0] ?? null;
    state.cachedDropsSnapshot = drops;
  };
  publishSnapshot();
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
        tabId: 22,
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
        checkedAt: now,
      },
      dispose: async () => {},
    }),
    prepareTabless: async () => null,
    release: async () => ({ kind: 'released', method: 'closed' }),
  });
  const browser: FarmingAutomationBrowser = {
    watch,
    hasNotificationPermission: async () => true,
    deliverNotification: async (notification) => ({ kind: 'delivered', notificationId: notification.id }),
    observeManualTabs: async () => ({ kind: 'observed', tabs: [] }),
    replaceDeadlineAlarm: async () => 'scheduled',
    schedulePeriodicAlarm: async () => 'scheduled',
  };
  const automation = createFarmingAutomation({
    state,
    persistence,
    browser,
    now: () => now,
    random: () => 0,
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
        streamers: availableStreamers ? [createStreamer()] : [],
        languageFilterApplied: false,
      }),
    },
  });
  const farming = createFarmingSession(state, createFarmingSessionAdapters());
  const outcomes: Awaited<ReturnType<typeof automation.request>>[] = [];
  let unavailable = true;
  let hiddenRefreshes = 0;
  const performSync = createServiceWorkerActivationSync({
    state,
    farmingSession: farming,
    automation: {
      ...automation,
      request: async (...args) => {
        const outcome = await automation.request(...args);
        outcomes.push(outcome);
        return outcome;
      },
    },
    refreshGamesCache: async () =>
      unavailable
        ? { kind: 'unavailable', failure: { kind: 'network', message: 'network unavailable' } }
        : { kind: 'refreshed', games: [skull, marvel], inventoryVerified: true },
    dropsPageRefresher: {
      openDropsPageAndRefresh: async () => {
        hiddenRefreshes += 1;
        publishSnapshot();
        return { success: true, gamesCount: 2 };
      },
    },
  });
  const coordinator = createActivationSyncCoordinator({
    getCampaignSyncState: () => state.appState.campaignSyncState,
    setCampaignSyncState: async (sync) => {
      state.appState.campaignSyncState = sync;
    },
    scheduleRetry: async () => {},
    clearRetry: async () => {},
    shouldRunPeriodicSync: () => true,
    performSync,
    now: () => now,
  });
  return {
    state,
    skull,
    marvel,
    coordinator,
    outcomes,
    automation,
    farming,
    recover: () => {
      unavailable = false;
    },
    hiddenRefreshes: () => hiddenRefreshes,
  };
}

test.each([
  true,
  false,
])('successful scheduled validation automatically starts eligible queue (manual authorization=%s)', async (manualAuthorized) => {
  const run = fixture(manualAuthorized);
  const failed = await run.coordinator.request('worker-start');
  expect(failed.kind).toBe('retry-scheduled');
  expect(run.state.appState.isRunning).toBe(false);
  run.recover();
  now = run.state.appState.campaignSyncState.nextRetryAt ?? now;
  const result = await run.coordinator.request('periodic-campaign');
  expect(result.kind).toBe('synced');
  expect(run.outcomes.at(-1)).toMatchObject({ kind: 'started' });
  expect(run.state.appState.isRunning).toBe(true);
  expect(run.state.appState.selectedGame?.campaignId).toBe(
    (manualAuthorized ? run.skull : run.marvel).campaignId,
  );
});

test('foreground validation honors prior explicit Stop even with favorite automation enabled', async () => {
  const run = fixture();
  await createFarmingAutomationUserActionHandlers(run.automation, run.farming).stopFarming();
  const result = await run.coordinator.request('manual');
  expect(result.kind).toBe('synced');
  expect(run.outcomes.at(-1)).toEqual({ kind: 'unchanged', reason: 'snoozed' });
  expect(run.state.appState.isRunning).toBe(false);
});

test('foreground validation automatically starts an authorized queue without another Start click', async () => {
  const run = fixture();
  const result = await run.coordinator.request('manual');
  expect(result.kind).toBe('synced');
  expect(run.outcomes.at(-1)).toMatchObject({ kind: 'started' });
  expect(run.state.appState.isRunning).toBe(true);
});

test('successful startup validation with empty directories preserves favorites and schedules another evaluation', async () => {
  const run = fixture(false, false);
  run.recover();
  expect((await run.coordinator.request('worker-start')).kind).toBe('synced');
  expect(run.outcomes.at(-1)).toEqual({ kind: 'unchanged', reason: 'no-eligible-campaign' });
  expect(run.state.appState.isRunning).toBe(false);
  expect(run.state.appState.queue.map(gameKey)).toContain(gameKey(run.marvel));
  expect(run.state.appState.campaignAvailabilityByKey[gameKey(run.marvel)]?.eligibleStreamerCount).toBe(0);
  expect(run.state.appState.nextAutomationCheckAt).toBeGreaterThan(now);
});
