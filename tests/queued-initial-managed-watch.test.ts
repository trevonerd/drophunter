import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import { createFarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import {
  deriveSafeRefreshPatch,
  type FarmingAutomationTwitchSnapshot,
} from '../src/background/farming-automation-twitch.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());

test('a stopped queued Play authorizes the first managed tab while automatic preparation cannot', async () => {
  const tabs = installManagedWatchPages(mocks);
  const state = createServiceWorkerState();
  const game = createGame({
    campaignId: 'smite-campaign',
    categorySlug: 'smite',
    endsAt: '2030-08-04T12:00:00.000Z',
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const drop = createDrop({ gameId: game.id, campaignId: game.campaignId });
  const streamer = createStreamer({ name: 'smite_streamer' });
  state.appState.watchTransportPreference = 'managed-tab';
  state.appState.queue = [game];
  const snapshot: FarmingAutomationTwitchSnapshot = {
    games: [game],
    drops: [drop],
    campaignDropsByKey: { [gameKey(game)]: [drop] },
    campaignChannelsMap: {},
    updatedAt: Date.now(),
  };
  const browser = createFarmingAutomationBrowser({
    getManualStreamContext: async () => null,
    watch: {
      tablessEnabled: false,
      heartbeat: async () => ({ accepted: false }),
      waitForTabComplete: async () => {},
      preparePlayback: async () => ({ isPlaybackReady: true }),
      probeManaged: async () => ({
        accepted: true,
        isLive: true,
        sameChannel: true,
        sameGame: true,
        hasDropsSignal: true,
      }),
    },
  });
  expect(await browser.watch.prepare({ gameId: game.id, channelName: streamer.name }, 'managed-tab')).toEqual(
    { kind: 'failed', reason: 'candidate-unavailable' },
  );
  expect(tabs.created).toEqual([]);
  expect(await listManagedWatches()).toEqual([]);

  const automation = createFarmingAutomation({
    state,
    browser,
    persistence: createInMemoryFarmingAutomationPersistence({
      state,
      storage: createInMemoryFarmingAutomationStorage(),
      getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
      broadcast: () => {},
    }),
    twitch: {
      refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
      fetchDirectory: async () => ({
        kind: 'ready',
        target: {
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: null,
          categorySlug: 'smite',
        },
        streamers: [streamer],
        languageFilterApplied: false,
      }),
    },
  });
  expect(await automation.startQueuedCampaign?.(gameKey(game))).toEqual({ success: true });
  expect(tabs.created).toHaveLength(1);
  expect(tabs.pages.get(tabs.created[0]!)?.url).toBe('https://www.twitch.tv/smite_streamer');
  expect(state.appState.isRunning).toBe(true);
  expect(state.appState.manualQueueAuthorized).toBe(true);
  expect(state.appState.farmingSessionOrigin).toBe('manual');
  expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
  expect(browser.watch.currentOwnership()).toMatchObject({
    kind: 'managed-tab',
    tabId: tabs.created[0],
    expectedChannel: streamer.name,
  });
  expect(await listManagedWatches()).toHaveLength(1);
});
