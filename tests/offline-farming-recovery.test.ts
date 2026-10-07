import { expect, test } from 'bun:test';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { setTimingSaveDebounceMsForTests } from '../src/background/timing-state-persistence.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createMinimalState, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';
import { createQueuedFarmingSession } from './support/queued-farming-session.ts';

test.each([false, true])(
  'confirmed offline turnover reuses its tab and ignores the departing reservation (stall deadline: %s)',
  async (overdue) => {
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    setTimingSaveDebounceMsForTests(0);
    try {
      const game = createGame({
        id: 'r6',
        name: 'Rainbow Six',
        categorySlug: 'rainbow-six',
        campaignId: 'r6-campaign',
        dropCount: 1,
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      });
      const drop = createDrop({
        gameId: game.id,
        campaignId: game.campaignId,
        requiredMinutes: 60,
        progress: 10,
        currentMinutes: 6,
      });
      const state = createMinimalState();
      Object.assign(state.appState, {
        isRunning: true,
        manualQueueAuthorized: true,
        farmingSessionOrigin: 'manual',
        watchTransportPreference: 'managed-tab',
        selectedGame: game,
        queue: [game],
        availableGames: [game],
        allDrops: [drop],
        pendingDrops: [drop],
        currentDrop: drop,
      });
      state.cachedDropsSnapshot = [drop];
      let offlineChannel: string | null = null;
      let replacement = 'second';
      const fetchStreamContext = async (tabId: number) => {
        const tab = await mocks.chrome.tabs.get(tabId);
        const channelName = new URL(tab.url ?? 'https://www.twitch.tv/first').pathname.slice(1);
        const isLive = channelName !== offlineChannel;
        return {
          channelName,
          categorySlug: game.categorySlug ?? '',
          categoryLabel: game.name,
          streamTitle: 'Drops',
          titleContainsDrops: true,
          hasDropsSignal: true,
          pageUrl: tab.url ?? '',
          isLive,
          isPlaybackReady: isLive,
        };
      };
      mocks.chrome.tabs.sendMessage = async () => ({ isPlaybackReady: true, userInteractionRequired: false });
      const browserEvents = createServiceWorkerBrowserEvents(state, {
        ensureContentScriptOnTab: async () => {},
        fetchStreamContext,
        heartbeat: async () => ({ accepted: false }),
        notify: async () => {},
        notifyQueueComplete: async () => {},
        clearQueueCompleteNotification: async () => {},
      });
      expect((await browserEvents.watchTransport.start(createStreamer({ name: 'first' }))).kind).toBe(
        'started',
      );
      const ownership = browserEvents.watchTransport.currentOwnership();
      if (ownership?.kind !== 'managed-tab') throw new Error('Expected an owned watch');
      const observedAt = Date.now() - (overdue ? 600_000 : 1_000);
      state.lastProgressAdvanceAt = observedAt;
      state.lastTrackedDropKey = `${game.campaignId}:${drop.id}`;
      state.lastTrackedProgress = drop.progress;
      state.lastTrackedMinutes = drop.currentMinutes ?? 0;
      state.streamValidationGraceUntil = 0;
      state.lastInventoryRefreshAt = Date.now();
      state.appState.queueEntryMetadataByKey[gameKey(game)] = {
        source: 'manual',
        addedAt: 1,
        reason: 'user-added',
        attemptedStreamerNames: ['failed-one', 'failed-two', 'failed-three', 'first'],
        watchAttempt: { channelName: 'first', observedAt },
      };
      const snapshot = {
        games: [game],
        drops: [drop],
        campaignsVerified: true,
        inventoryVerified: true,
        updatedAt: Date.now(),
      };
      let directoryChecks = 0;
      const farming = createQueuedFarmingSession(state, {
        browserEvents,
        startMonitoring: () => {},
        reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
        twitchGateway: {
          ensureTwitchSession: async () => ({
            oauthToken: 'a'.repeat(30),
            userId: '123',
            deviceId: 'device',
            uuid: 'uuid',
          }),
          fetchDropsSnapshot: async () => ({ ...snapshot, updatedAt: Date.now() }),
          getLatestProgressSnapshot: () => snapshot,
          fetchInventorySnapshot: async () => snapshot,
          fetchDirectoryStreamers: async () => {
            directoryChecks++;
            return Object.assign([createStreamer({ name: replacement })], { languageFilterApplied: false });
          },
          fetchStreamContext,
          heartbeat: async () => ({ accepted: false }),
        },
      });
      for (const next of overdue ? ['second'] : ['second', 'third', 'fourth', 'fifth', 'sixth']) {
        offlineChannel = state.appState.activeStreamer?.name ?? null;
        replacement = next;
        const checksBefore = directoryChecks;
        await farming.checkDropProgress();
        expect(directoryChecks).toBe(checksBefore);
        expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
        await farming.checkDropProgress();
        expect(directoryChecks).toBeGreaterThan(checksBefore);
        expect(state.appState.activeStreamer?.name).toBe(next);
        expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
        expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.attemptedStreamerNames).toEqual([
          'failed-one',
          'failed-two',
          'failed-three',
          next,
        ]);
        expect(browserEvents.watchTransport.currentOwnership()).toMatchObject({
          tabId: ownership.tabId,
          expectedChannel: next,
        });
        expect(tabs.created).toHaveLength(1);
        expect(tabs.pages.get(ownership.tabId)?.url).toBe(`https://www.twitch.tv/${next}`);
        expect(state.appState.watchHealth?.isHealthy).toBe(true);
        expect(state.appState.queueAcquisitionRound).toBeNull();
      }
    } finally {
      setTimingSaveDebounceMsForTests(null);
      mocks.teardown();
    }
  },
);
