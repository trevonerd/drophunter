import { expect, test } from 'bun:test';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import { createFarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { deriveSafeRefreshPatch } from '../src/background/farming-automation-twitch.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { reconcileManagedWatchesOnStartup } from '../src/background/managed-watch-startup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

test('automatic queue defers native creation on transient old-tab proof failure and retries without duplicates', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const old = tabs.add('https://www.twitch.tv/old_channel');
    tabs.add('https://www.twitch.tv/user_choice');
    await managedWatchMarker.write(old.id, 'previous-worker-owned', old.url);
    const execute = mocks.chrome.scripting.executeScript;
    mocks.chrome.scripting.executeScript = async (options) => {
      if (options.func.name === 'readManagedWatchMarkerInPage') throw new Error('Page not available yet');
      return execute(options);
    };
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'favorite-proof-retry',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const drop = createDrop({ gameId: game.id, campaignId: game.campaignId });
    state.appState.autoStartFavoriteGames = true;
    state.appState.watchTransportPreference = 'managed-tab';
    state.appState.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: Date.now() }];
    state.appState.availableGames = [game];
    state.appState.queue = [game];
    state.appState.selectedGame = game;
    state.appState.allDrops = [drop];
    state.cachedDropsSnapshot = [drop];
    expect(await reconcileManagedWatchesOnStartup(state, null)).toBeNull();
    const storage = createInMemoryFarmingAutomationStorage();
    const persistence = createInMemoryFarmingAutomationPersistence({
      state,
      storage,
      getSessionRevision: () => '0',
      broadcast: () => {},
    });
    const adapter = createFarmingAutomationBrowser({
      getManualStreamContext: async () => null,
      watch: {
        tablessEnabled: true,
        heartbeat: async () => ({ accepted: false }),
        waitForTabComplete: async () => {},
        preparePlayback: async () => ({ isPlaybackReady: true }),
        probeManaged: async () => ({ accepted: true, isLive: true, sameChannel: true, sameGame: true }),
      },
    });
    const snapshot = {
      games: [game],
      drops: [drop],
      updatedAt: Date.now(),
      campaignDropsByKey: { [gameKey(game)]: [drop] },
      campaignChannelsMap: {},
    };
    const automation = createFarmingAutomation({
      state,
      persistence,
      browser: { ...adapter, observeManualTabs: async () => ({ kind: 'observed', tabs: [] }) },
      twitch: {
        refresh: async () => ({ kind: 'ready', snapshot, refreshPatch: deriveSafeRefreshPatch(snapshot) }),
        fetchDirectory: async () => ({
          kind: 'ready',
          target: {
            campaignKey: gameKey(game),
            campaignId: game.campaignId,
            gameId: game.id,
            gameName: game.name,
            categoryId: null,
            categorySlug: game.name,
          },
          streamers: [createStreamer()],
          languageFilterApplied: false,
        }),
      },
    });
    expect(await automation.request('worker-start')).toMatchObject({
      kind: 'failed',
      reason: 'candidate-preparation-failed',
    });
    expect(tabs.pages.size).toBe(2);
    expect(tabs.removed).toEqual([]);
    expect(state.appState.nextAutomationCheckAt).toBeGreaterThan(Date.now());
    const facts = await persistence.loadFacts();
    expect(facts.kind === 'ready' && facts.value.nextEvaluationAt).toBe(state.appState.nextAutomationCheckAt);
    expect(
      mocks.alarms._created.some((alarm) => alarm.info.when === state.appState.nextAutomationCheckAt),
    ).toBe(true);
    mocks.chrome.scripting.executeScript = execute;
    expect(await automation.request('periodic')).toMatchObject({ kind: 'started' });
    expect(tabs.removed).toEqual([old.id]);
    expect(tabs.pages.size).toBe(2);
  } finally {
    mocks.teardown();
  }
});
