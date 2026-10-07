import { expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { syncTwitchSessionFromContentScriptExt } from '../src/background/session-management.ts';
import { setTimingSaveDebounceMsForTests } from '../src/background/timing-state-persistence.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createUserStatusModel } from '../src/shared/user-status.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';
import { createQueuedFarmingSession } from './support/queued-farming-session.ts';

test.each([true, false])('queued Play survives a partial page session (%s)', async (healthy) => {
  setTimingSaveDebounceMsForTests(0);
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const state = createServiceWorkerState();
    const games = ['first', 'second'].map((id) =>
      createGame({
        id,
        name: id,
        categorySlug: id,
        campaignId: `${id}-campaign`,
        dropCount: 1,
        endsAt: id === 'first' ? '2030-08-05T12:00:00.000Z' : '2030-08-04T12:00:00.000Z',
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      }),
    );
    const drops = games.map((game) =>
      createDrop({
        id: `${game.id}-drop`,
        gameId: game.id,
        gameName: game.name,
        campaignId: game.campaignId,
        requiredMinutes: 60,
      }),
    );
    const [incumbent, requested] = games;
    if (!incumbent || !requested) throw new Error('Expected two campaigns');
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      watchTransportPreference: 'managed-tab',
      selectedGame: incumbent,
      queue: games,
      availableGames: games,
      allDrops: [drops[0]],
      pendingDrops: [drops[0]],
      currentDrop: drops[0],
      autoStartFavoriteGames: true,
      favoriteGames: [{ gameId: requested.id, lastKnownName: requested.name, addedAt: 1 }],
    });
    state.cachedDropsSnapshot = drops;
    state.appState.queueEntryMetadataByKey = Object.fromEntries(
      games.map((game) => [gameKey(game), { source: 'manual', addedAt: 1, reason: 'user-added' }]),
    );
    let dropsVisible = true;
    const fetchStreamContext = async (tabId: number) => {
      const tab = await mocks.chrome.tabs.get(tabId);
      const channelName = new URL(tab.url ?? 'https://www.twitch.tv/first_streamer').pathname.slice(1);
      const category = channelName.split('_')[0] ?? '';
      return {
        channelName,
        categorySlug: category,
        categoryLabel: category,
        streamTitle: 'Drops enabled',
        titleContainsDrops: true,
        pageUrl: tab.url ?? '',
        isLive: true,
        isPlaybackReady: true,
        hasDropsSignal: channelName !== 'first_streamer' || dropsVisible,
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
    await browserEvents.watchTransport.start(createStreamer({ name: 'first_streamer' }));
    const firstOwnership = browserEvents.watchTransport.currentOwnership();
    expect(firstOwnership?.kind).toBe('managed-tab');
    if (firstOwnership?.kind !== 'managed-tab') throw new Error('Expected incumbent ownership');
    const snapshot = {
      games,
      drops,
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    const session = { oauthToken: 'a'.repeat(30), userId: '123', deviceId: 'device-id', uuid: 'uuid' };
    const farming = createQueuedFarmingSession(state, {
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      browserEvents,
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => {
          state.twitchSessionCache = session;
          return session;
        },
        fetchDropsSnapshot: async () => ({ ...snapshot, updatedAt: Date.now() }),
        getLatestProgressSnapshot: () => snapshot,
        fetchInventorySnapshot: async () => snapshot,
        fetchDirectoryStreamers: async (game) =>
          Object.assign([createStreamer({ name: `${game.id}_streamer` })], { languageFilterApplied: false }),
        fetchStreamContext,
        heartbeat: async () => ({ accepted: false }),
      },
    });

    dropsVisible = healthy;
    await browserEvents.watchTransport.tick();
    let sessionReported = false;
    let duringPreparation = structuredClone(state.appState);
    mocks.chrome.tabs.sendMessage = async (tabId) => {
      if (!sessionReported && tabs.pages.get(tabId)?.url.endsWith('/second_streamer')) {
        duringPreparation = structuredClone(state.appState);
        sessionReported = true;
        await syncTwitchSessionFromContentScriptExt(state, { ...session, userId: '' }, tabId, {
          shouldRefreshCampaignsAfterSessionSync: () => false,
          onRefreshCampaigns: async () => {},
          onSaveState: async () => {},
          onBroadcastStateUpdate: () => {},
        });
      }
      return { isPlaybackReady: true, userInteractionRequired: false };
    };
    const result = await farming.handleStartQueuedCampaign(gameKey(requested));
    expect(result).toEqual({ success: true });
    expect(state.appState.selectedGame?.campaignId).toBe(requested.campaignId);
    expect(browserEvents.watchTransport.currentOwnership()).toEqual(firstOwnership);
    expect(tabs.pages.get(firstOwnership.tabId)?.url).toBe('https://www.twitch.tv/first_streamer');
    await farming.checkDropProgress();

    expect(sessionReported).toBe(true);
    expect(duringPreparation.activeStreamer).toBeNull();
    expect(duringPreparation.pendingWatchTarget).toMatchObject({
      game: requested,
      channelName: 'second_streamer',
    });
    expect(
      createUserStatusModel({
        state: duringPreparation,
        runtimeMode: 'running',
        currentAutomatableDrop: duringPreparation.currentDrop,
        recoveryNow: Date.now(),
      }),
    ).toMatchObject({ label: 'Switching to', subject: 'second', progressState: 'waiting' });
    expect(state.appState.selectedGame?.campaignId).toBe(requested.campaignId);
    expect(state.appState.activeStreamer?.name).toBe('second_streamer');
    expect(state.appState.pendingWatchTarget).toBeNull();
    expect(tabs.created).toHaveLength(1);
    expect(state.appState.tabId).toBe(firstOwnership.tabId);
    expect(state.appState.queue.map(gameKey)).toEqual([gameKey(requested), gameKey(incumbent)]);
    expect(state.appState.forcedCampaignKey).toBe(gameKey(requested));
    expect(browserEvents.watchTransport.currentTarget()?.campaignId).toBe(requested.campaignId);
    const ownership = browserEvents.watchTransport.currentOwnership();
    expect(ownership).toMatchObject({ kind: 'managed-tab', expectedChannel: 'second_streamer' });
    if (ownership?.kind !== 'managed-tab') throw new Error('Expected replacement ownership');
    expect(tabs.pages.get(ownership.tabId)?.url).toBe('https://www.twitch.tv/second_streamer');
  } finally {
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  }
});
