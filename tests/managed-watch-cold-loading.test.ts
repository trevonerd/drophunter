import { expect, spyOn, test } from 'bun:test';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { setTimingSaveDebounceMsForTests } from '../src/background/timing-state-persistence.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';
import { createQueuedFarmingSession } from './support/queued-farming-session.ts';

const modes = ['ready', 'deadline', 'deadline20', 'progress', 'pause', 'stop'];
test.each(modes)('cold managed player %s retains ownership across restoration', async (mode) => {
  const mocks = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
  const tabs = installManagedWatchPages(mocks);
  const retained = tabs.add('https://www.twitch.tv/old_channel');
  await managedWatchMarker.write(retained.id, 'cold-loading', retained.url);
  const game = createGame({ campaignId: 'cold-campaign', categorySlug: 'test-game', dropCount: 1 });
  const other = createGame({ id: 'other', campaignId: 'other-campaign', categorySlug: 'other-game' });
  const drop = createDrop({
    campaignId: game.campaignId,
    requiredMinutes: mode === 'deadline20' ? 400 : 60,
    progress: 10,
  });
  let now = Date.now();
  let ready = false;
  let playbackRequests = 0;
  const requestedTabs = new Set<number>();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  const originalTimeout = globalThis.setTimeout;
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: (callback: () => void, delay: number) => {
      if (delay !== 500) return originalTimeout(callback, delay);
      now += delay;
      callback();
      return 1;
    },
  });
  let state = createServiceWorkerState();
  Object.assign(state.appState, {
    isRunning: true,
    manualQueueAuthorized: true,
    farmingSessionOrigin: 'manual',
    watchTransportPreference: 'managed-tab',
    selectedGame: game,
    streamerSelectionMode: 'top-viewers',
    queue: [game, other],
    availableGames: [game, other],
    currentDrop: drop,
    allDrops: [drop],
    pendingDrops: [drop],
  });
  state.cachedDropsSnapshot = [drop];
  const snapshot = {
    games: [game, other],
    drops: [drop],
    campaignsVerified: true,
    inventoryVerified: true,
    updatedAt: now,
  };
  const context = async (tabId: number) => {
    const pageUrl = (await mocks.chrome.tabs.get(tabId)).url ?? '';
    return {
      channelName: new URL(pageUrl).pathname.slice(1),
      pageUrl,
      categorySlug: game.categorySlug ?? '',
      categoryLabel: game.name,
      streamTitle: 'Drops',
      titleContainsDrops: true,
      hasDropsSignal: true,
      isLive: true,
      isPlaybackReady: ready || pageUrl.endsWith('/second'),
    };
  };
  mocks.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type !== 'PREPARE_STREAM_PLAYBACK') return {};
    requestedTabs.add(tabId);
    playbackRequests++;
    const playbackReady = ready || retained.url.endsWith('/second');
    retained.playing = playbackReady;
    return { isPlaybackReady: playbackReady, playbackPending: !playbackReady };
  };
  const build = () => {
    const browserEvents = createServiceWorkerBrowserEvents(state, {
      ensureContentScriptOnTab: async () => {},
      fetchStreamContext: context,
      heartbeat: async () => ({ accepted: false }),
      notify: async () => {},
      notifyQueueComplete: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
    return createQueuedFarmingSession(state, {
      browserEvents,
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => ({
          oauthToken: 'a'.repeat(30),
          userId: '123',
          deviceId: 'device',
          uuid: 'uuid',
        }),
        fetchDropsSnapshot: async () => ({ ...snapshot, updatedAt: now }),
        getLatestProgressSnapshot: () => snapshot,
        fetchInventorySnapshot: async () => snapshot,
        fetchDirectoryStreamers: async () =>
          Object.assign(
            [
              createStreamer({ name: 'first', viewerCount: 50 }),
              createStreamer({ name: 'second', viewerCount: 25 }),
            ],
            { languageFilterApplied: false },
          ),
        fetchStreamContext: context,
        heartbeat: async () => ({ accepted: false }),
      },
    });
  };
  let session = build();
  try {
    const key = gameKey(game);
    let observedAt: number | undefined;
    for (let retry = 0; retry < 2; retry++) {
      const startedAt = now;
      const requestsBefore = playbackRequests;
      await session.checkDropProgress();
      expect(now - startedAt).toBeLessThanOrEqual(30_000);
      expect(playbackRequests).toBeGreaterThan(requestsBefore);
      expect([...requestedTabs]).toEqual([retained.id]);
      expect(retained.url).toBe('https://www.twitch.tv/first');
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual(['first']);
      expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt).toMatchObject({
        channelName: 'first',
        preparing: true,
      });
      expect(state.appState.pendingWatchTarget).toMatchObject({
        game: { campaignId: game.campaignId },
        channelName: 'first',
      });
      expect(state.appState.activeStreamer).toBeNull();
      expect(state.appState.campaignFailureEpisodesByKey).toEqual({});
      expect(state.appState.queue.map(gameKey)).toEqual([key, gameKey(other)]);
      expect(tabs.navigated).toHaveLength(1);
      expect(tabs.updated.some((update) => update.properties.url)).toBe(false);
      expect(tabs.created).toEqual([]);
      expect(tabs.removed).toEqual([]);
      const attempt = state.appState.queueEntryMetadataByKey[key]?.watchAttempt;
      observedAt ??= attempt?.observedAt;
      expect(attempt?.observedAt).toBe(observedAt);
      const retryAt = state.appState.recoveryBackoffUntil;
      expect(retryAt).toBeGreaterThan(now);
      if (retry === 0) {
        session.stopMonitoring();
        const restored = createServiceWorkerState();
        restored.appState = normalizeStoredAppState(structuredClone(state.appState));
        restored.appState.pendingWatchTarget = null;
        restored.recoveryBackoffUntil = retryAt ?? 0;
        restored.cachedDropsSnapshot = state.cachedDropsSnapshot;
        state = restored;
        expect(state.appState.pendingWatchTarget).toBeNull();
        expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt).toMatchObject({
          channelName: 'first',
          preparing: true,
          observedAt,
        });
        session = build();
      }
      now = (retryAt ?? now) + 1;
    }
    if (mode === 'pause' || mode === 'stop') {
      await (mode === 'pause' ? session.handlePauseFarming() : session.handleStopFarming());
      const requestsBefore = playbackRequests;
      ready = true;
      now += 20 * 60_000;
      await session.checkDropProgress();
      expect(playbackRequests).toBe(requestsBefore);
      expect(state.appState.pendingWatchTarget).toBeNull();
      expect(state.appState.activeStreamer).toBeNull();
      expect(retained.playing).toBe(false);
      expect(state.appState.isPaused).toBe(mode === 'pause');
      expect(tabs.created).toEqual([]);
      return;
    }
    if (mode === 'progress') {
      now = (observedAt ?? now) + 4 * 60_000;
      drop.progress = 20;
      await session.checkDropProgress();
      const refreshed = state.appState.queueEntryMetadataByKey[key]?.watchAttempt;
      expect(refreshed?.observedAt).toBeGreaterThan(observedAt ?? 0);
      expect(refreshed?.preparationProgress).toBe(20);
      now = (observedAt ?? now) + 5 * 60_000 + 1;
      await session.checkDropProgress();
      expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt?.preparing).toBe(true);
      expect(state.appState.pendingWatchTarget?.channelName).toBe('first');
      expect(state.appState.campaignFailureEpisodesByKey).toEqual({});
    }
    if (mode.startsWith('deadline')) {
      const threshold = (mode === 'deadline20' ? 20 : 5) * 60_000;
      now = (observedAt ?? now) + threshold - 60_000;
      await session.checkDropProgress();
      expect(state.appState.queueEntryMetadataByKey[key]?.watchAttempt?.preparing).toBe(true);
      expect(state.appState.campaignFailureEpisodesByKey).toEqual({});
      now = (observedAt ?? now) + threshold + 1;
      for (let attempt = 0; attempt < 3 && !state.appState.activeStreamer; attempt++) {
        await session.checkDropProgress();
        now = Math.max(now, state.appState.recoveryBackoffUntil ?? 0) + 1;
      }
      expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toEqual([
        'first',
        'second',
      ]);
    } else ready = true;
    now = Math.max(now, state.appState.recoveryBackoffUntil ?? 0) + 1;
    await session.checkDropProgress();
    expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
    expect(state.appState.activeStreamer?.name).toBe(mode.startsWith('deadline') ? 'second' : 'first');
    expect(state.appState.tabId).toBe(retained.id);
    expect(state.appState.watchHealth?.isHealthy).toBe(true);
    expect(state.appState.pendingWatchTarget).toBeNull();
    expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.watchAttempt?.preparing).not.toBe(true);
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
    expect(tabs.navigated).toHaveLength(mode.startsWith('deadline') ? 2 : 1);
  } finally {
    session.stopMonitoring();
    setTimingSaveDebounceMsForTests(null);
    Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: originalTimeout });
    clock.mockRestore();
    mocks.teardown();
  }
});
