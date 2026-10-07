import { expect, spyOn, test } from 'bun:test';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import {
  loadState,
  loadTimingState,
  sessionDebugSummary,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { createDrop, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';
import { createQueuedFarmingSession } from './support/queued-farming-session.ts';

test('manual ownership-proof retries preserve the failure budget and recover after worker restart without Play', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  setTimingSaveDebounceMsForTests(0);
  try {
    const retained = tabs.add('https://www.twitch.tv/old_channel');
    tabs.add('https://www.twitch.tv/user_choice');
    await managedWatchMarker.write(retained.id, 'previous-manual-worker', retained.url);
    const execute = mocks.chrome.scripting.executeScript;
    mocks.chrome.scripting.executeScript = async (options) => {
      if (options.func.name === 'readManagedWatchMarkerInPage') throw new Error('Proof unavailable');
      return execute(options);
    };
    const game = createGame({
      campaignId: 'manual-proof-retry',
      categorySlug: 'test-game',
      dropCount: 1,
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    const drop = createDrop({ gameId: game.id, campaignId: game.campaignId, requiredMinutes: 60 });
    let state = createServiceWorkerState();
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
    const snapshot = {
      games: [game],
      drops: [drop],
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: now,
    };
    const fetchStreamContext = async (tabId: number) => ({
      channelName: new URL((await mocks.chrome.tabs.get(tabId)).url ?? retained.url).pathname.slice(1),
      categorySlug: game.categorySlug ?? '',
      categoryLabel: game.name,
      streamTitle: 'Drops',
      titleContainsDrops: true,
      hasDropsSignal: true,
      pageUrl: 'https://www.twitch.tv/first',
      isLive: true,
      isPlaybackReady: true,
    });
    mocks.chrome.tabs.sendMessage = async () => ({ isPlaybackReady: true, userInteractionRequired: false });
    let directoryChecks = 0;
    const buildSession = () => {
      const browserEvents = createServiceWorkerBrowserEvents(state, {
        ensureContentScriptOnTab: async () => {},
        fetchStreamContext,
        heartbeat: async () => ({ accepted: false }),
        notify: async () => {},
        notifyQueueComplete: async () => {},
        clearQueueCompleteNotification: async () => {},
      });
      return {
        browserEvents,
        session: createQueuedFarmingSession(state, {
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
            fetchDropsSnapshot: async () => ({ ...snapshot, updatedAt: now }),
            getLatestProgressSnapshot: () => snapshot,
            fetchInventorySnapshot: async () => snapshot,
            fetchDirectoryStreamers: async () => {
              directoryChecks++;
              return Object.assign([createStreamer({ name: 'first' })], { languageFilterApplied: false });
            },
            fetchStreamContext,
            heartbeat: async () => ({ accepted: false }),
          },
        }),
      };
    };
    let harness = buildSession();
    for (let attempt = 0; attempt < 6; attempt++) {
      await harness.session.checkDropProgress();
      expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.attemptedStreamerNames ?? []).toEqual([]);
      expect(state.appState.watchHealth?.reason).toBe('managed-tab-unavailable');
      expect(state.appState.manualQueueAuthorized).toBe(true);
      expect(state.appState.isRunning).toBe(true);
      const retryAt = state.appState.recoveryBackoffUntil;
      if (!retryAt) throw new Error('Expected a durable ownership recovery retry');
      expect(retryAt).toBeGreaterThan(now);
      expect(mocks.alarms._created.some((alarm) => alarm.info.when === retryAt)).toBe(true);
      expect(tabs.created).toEqual([]);
      expect(tabs.removed).toEqual([]);
      expect(tabs.pages.get(retained.id)?.url).toBe(retained.url);
      if (attempt === 0) {
        harness.session.stopMonitoring();
        state = createServiceWorkerState();
        await loadState(
          state,
          {
            onLoadTimingState: () => loadTimingState(state),
            onEnforceInactivityReset: async () => false,
          },
          {
            sanitizeTwitchSession: () => null,
            sessionDebugSummary,
            createInitialState,
            clearRotationMetadata: (appState) => appState,
            TWITCH_SESSION_STORAGE_KEY: 'twitchSession',
            DROPS_SNAPSHOT_CACHE_KEY: 'dropsSnapshotCache',
            LAST_ACTIVITY_AT_KEY: 'lastActivityAt',
            TIMING_STATE_KEY: 'timingState',
            STREAM_VALIDATION_GRACE_MS: 0,
          },
        );
        expect(state.appState.recoveryBackoffUntil).toBe(retryAt);
        expect(state.appState.manualQueueAuthorized).toBe(true);
        harness = buildSession();
      }
      now = retryAt + 1;
    }
    mocks.chrome.scripting.executeScript = execute;
    await harness.session.checkDropProgress();
    expect(directoryChecks).toBeGreaterThanOrEqual(6);
    expect(state.appState.activeStreamer?.name).toBe('first');
    expect(state.appState.watchHealth?.isHealthy).toBe(true);
    expect(state.appState.queueAcquisitionRound).toBeNull();
    expect(harness.browserEvents.watchTransport.currentOwnership()).toMatchObject({ tabId: retained.id });
    expect(tabs.pages.get(retained.id)?.url).toBe('https://www.twitch.tv/first');
    expect(tabs.created).toEqual([]);
    expect(tabs.removed).toEqual([]);
    harness.session.stopMonitoring();
  } finally {
    clock.mockRestore();
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  }
});
