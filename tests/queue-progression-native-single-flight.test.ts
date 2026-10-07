import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createMinimalState,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { required } from './support/required.ts';

test('authoritative cleanup and completion share one native successor preparation', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    const state = createMinimalState();
    const games = ['first', 'second'].map((id) =>
      createGame({ id, name: id, campaignId: id, categorySlug: id }),
    );
    const drops = games.map((game) =>
      createDrop({ id: game.id, gameId: game.id, campaignId: game.campaignId, requiredMinutes: 60 }),
    );
    const first = required(games[0]);
    const second = required(games[1]);
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      watchTransportPreference: 'managed-tab',
      selectedGame: first,
      queue: games,
      availableGames: games,
      allDrops: [drops[0]],
      pendingDrops: [drops[0]],
      currentDrop: drops[0],
    });
    state.cachedDropsSnapshot = drops;
    let holdSuccessor = false;
    mocks.chrome.tabs.sendMessage = async (id) => {
      if (holdSuccessor && tabs.pages.get(id)?.url.endsWith('/second_streamer')) {
        ready.resolve();
        await release.promise;
      }
      return { isPlaybackReady: true };
    };
    const fetchStreamContext = async (id: number) => {
      const pageUrl = tabs.pages.get(id)?.url ?? '';
      const channelName = new URL(pageUrl).pathname.slice(1);
      return {
        channelName,
        categorySlug: channelName.split('_')[0] ?? '',
        categoryLabel: '',
        streamTitle: 'Drops',
        titleContainsDrops: true,
        pageUrl,
        isLive: true,
        isPlaybackReady: true,
        hasDropsSignal: true,
      };
    };
    const events = createServiceWorkerBrowserEvents(state, {
      ensureContentScriptOnTab: async () => {},
      fetchStreamContext,
      heartbeat: async () => ({ accepted: false }),
      notify: async () => {},
      notifyQueueComplete: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
    await events.watchTransport.start(createStreamer({ name: 'first_streamer' }));
    let discoveries = 0;
    const snapshot = {
      games,
      drops,
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: events.watchTransport,
        fetchStreamContext,
        fetchDropsSnapshotFromApi: async () => snapshot,
        fetchInventorySnapshotFromApi: async () => snapshot,
        fetchDirectoryStreamersFromApi: async (game) => {
          discoveries++;
          return Object.assign([createStreamer({ name: `${game.id}_streamer` })], {
            languageFilterApplied: true,
          });
        },
      }),
    );
    required(drops[0]).claimed = true;
    state.appState.currentDrop = null;
    state.appState.pendingDrops = [];
    holdSuccessor = true;
    const cleanup = session.handleAuthoritativeCampaignUnavailable(first);
    await ready.promise;
    const completion = session.advanceQueueIfCompleted();
    await new Promise((resolve) => setTimeout(resolve, 10));
    release.resolve();
    await Promise.all([cleanup, completion]);
    expect(discoveries).toBe(1);
    expect(state.appState.selectedGame?.campaignId).toBe(second.campaignId);
    expect(events.watchTransport.currentOwnership()).toMatchObject({ expectedChannel: 'second_streamer' });
    expect(state.appState.recoveryReason).toBeNull();
    expect(state.appState.manualQueueAuthorized).toBe(true);
  } finally {
    release.resolve();
    mocks.teardown();
  }
});
