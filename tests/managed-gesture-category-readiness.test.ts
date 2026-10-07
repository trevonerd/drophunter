import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

test.each([
  'gesture-category-loading',
  'gesture-wrong-category',
  'gesture-wrong-channel',
  'playing-category-loading',
] as const)('native queued acquisition treats %s without inventing category proof', async (scenario) => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const state = createServiceWorkerState();
    const game = createGame({
      id: 'smite',
      name: 'SMITE 2',
      categorySlug: 'smite-2',
      campaignId: 'smite-campaign',
    });
    const drop = createDrop({ gameId: game.id, campaignId: game.campaignId, requiredMinutes: 60 });
    const streamer = createStreamer({ name: 'nika' });
    Object.assign(state.appState, {
      watchTransportPreference: 'managed-tab',
      queue: [game],
      availableGames: [game],
    });
    state.cachedDropsSnapshot = [drop];
    let mounted = false;
    const gesture = scenario !== 'playing-category-loading';
    mocks.chrome.tabs.sendMessage = async () => ({
      isPlaybackReady: !gesture,
      userInteractionRequired: gesture,
    });
    const fetchStreamContext = async (tabId: number) => ({
      channelName: scenario === 'gesture-wrong-channel' ? 'another-channel' : 'nika',
      categorySlug: mounted ? 'smite-2' : scenario === 'gesture-wrong-category' ? 'albion-online' : '',
      categoryLabel: mounted ? 'SMITE 2' : scenario === 'gesture-wrong-category' ? 'Albion Online' : '',
      streamTitle: 'Nika',
      titleContainsDrops: false,
      hasDropsSignal: false,
      isLive: true,
      isPlaybackReady: mounted || !gesture,
      pageUrl: (await mocks.chrome.tabs.get(tabId)).url ?? '',
    });
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
    const farming = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: browserEvents.watchTransport,
        fetchStreamContext,
        fetchDropsSnapshotFromApi: async () => snapshot,
        fetchInventorySnapshotFromApi: async () => snapshot,
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign([streamer], { languageFilterApplied: false }),
      }),
    );
    expect(await farming.handleStartQueuedCampaign(gameKey(game))).toEqual({ success: true });
    await farming.checkDropProgress();
    if (scenario === 'gesture-category-loading') {
      expect(state.appState.activeStreamer?.name).toBe('nika');
      expect(state.appState.watchHealth).toMatchObject({
        status: 'degraded',
        reason: 'user-interaction-required',
        isHealthy: false,
      });
      expect(state.appState.recoveryReason).toBeNull();
      expect(tabs.created).toHaveLength(1);
      expect(tabs.removed).toEqual([]);
      mounted = true;
      state.streamValidationGraceUntil = 0;
      await farming.checkDropProgress();
      expect(state.appState.watchHealth?.reason).toBe('heartbeat');
      expect(state.appState.activeStreamer?.name).toBe('nika');
      expect(state.streamValidationGraceUntil).toBeGreaterThan(Date.now());
    } else {
      expect(state.appState.activeStreamer).toBeNull();
      expect(state.appState.recoveryReason).toBe('open-failed');
      expect(browserEvents.watchTransport.currentTarget()).toBeNull();
    }
  } finally {
    mocks.teardown();
  }
});
