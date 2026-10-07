import { expect, test } from 'bun:test';
import { createFarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { setTimingSaveDebounceMsForTests } from '../src/background/timing-state-persistence.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';
import { createQueuedFarmingSession } from './support/queued-farming-session.ts';

test('a stopped queued Play authorizes the first managed tab while automatic preparation cannot', async () => {
  const mocks = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
  try {
    const tabs = installManagedWatchPages(mocks);
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'smite-campaign',
      categorySlug: 'smite',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const drop = createDrop({ gameId: game.id, campaignId: game.campaignId, requiredMinutes: 60 });
    const streamer = createStreamer({ name: 'smite_streamer' });
    const fetchStreamContext = async (tabId: number) => {
      const tab = await mocks.chrome.tabs.get(tabId);
      const channelName = new URL(tab.url ?? 'https://www.twitch.tv/smite_streamer').pathname.slice(1);
      return {
        channelName,
        categorySlug: 'smite',
        categoryLabel: 'SMITE',
        streamTitle: 'Drops enabled',
        titleContainsDrops: true,
        hasDropsSignal: true,
        isLive: true,
        isPlaybackReady: true,
        pageUrl: tab.url ?? '',
      };
    };
    state.appState.watchTransportPreference = 'managed-tab';
    state.appState.queue = [game];
    const automaticBrowser = createFarmingAutomationBrowser({
      getManualStreamContext: async () => null,
      watch: {
        tablessEnabled: false,
        heartbeat: async () => ({ accepted: false }),
        waitForTabComplete: async () => {},
        preparePlayback: async () => ({ isPlaybackReady: true }),
        probeManaged: async () => ({ accepted: true }),
      },
    });
    expect(
      await automaticBrowser.watch.prepare({ gameId: game.id, channelName: streamer.name }, 'managed-tab'),
    ).toMatchObject({
      kind: 'failed',
      reason: 'candidate-unavailable',
      health: { mode: 'managed-tab', status: 'failed', reason: 'managed-tab-unavailable' },
    });
    expect(tabs.created).toEqual([]);
    mocks.chrome.tabs.sendMessage = async () => ({ isPlaybackReady: true });
    const browserEvents = createServiceWorkerBrowserEvents(state, {
      ensureContentScriptOnTab: async () => {},
      fetchStreamContext,
      heartbeat: async () => ({ accepted: false }),
      notify: async () => {},
      notifyQueueComplete: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
    const snapshot = {
      games: [game],
      drops: [drop],
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    const farming = createQueuedFarmingSession(state, {
      browserEvents,
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => null,
        fetchDropsSnapshot: async () => snapshot,
        fetchInventorySnapshot: async () => snapshot,
        getLatestProgressSnapshot: () => snapshot,
        fetchDirectoryStreamers: async () => Object.assign([streamer], { languageFilterApplied: false }),
        fetchStreamContext,
        heartbeat: async () => ({ accepted: false }),
      },
    });
    const result = await farming.handleStartQueuedCampaign(gameKey(game));
    expect(result).toEqual({ success: true });
    expect(tabs.created).toEqual([]);
    expect(state.appState).toMatchObject({
      isRunning: true,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      forcedCampaignKey: gameKey(game),
      activeStreamer: null,
      tabId: null,
      watchHealth: null,
    });
    await farming.checkDropProgress();
    expect(tabs.created).toHaveLength(1);
    const tabId = tabs.created[0];
    if (tabId === undefined) throw new Error('Missing created tab');
    expect(tabs.pages.get(tabId)?.url).toBe('https://www.twitch.tv/smite_streamer');
    expect(state.appState).toMatchObject({
      isRunning: true,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      forcedCampaignKey: gameKey(game),
    });
    expect(browserEvents.watchTransport.currentOwnership()).toMatchObject({
      kind: 'managed-tab',
      tabId: tabs.created[0],
      expectedChannel: streamer.name,
    });
    expect(await listManagedWatches()).toHaveLength(1);
  } finally {
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  }
});
