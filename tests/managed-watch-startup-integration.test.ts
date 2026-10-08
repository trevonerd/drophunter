import { expect, test } from 'bun:test';
import { prepareBrowserSessionResume } from '../src/background/browser-session-resume.ts';
import { projectDropsSnapshot } from '../src/background/drops-projection.ts';
import { createFarmingAutomation } from '../src/background/farming-automation.ts';
import { createFarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import type { WatchOwnershipV1 } from '../src/background/farming-automation-contracts.ts';
import { createChromeFarmingAutomationPersistence } from '../src/background/farming-automation-persistence.ts';
import { createFarmingAutomationTwitchAdapter } from '../src/background/farming-automation-twitch.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { currentFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { openOwnedManagedWatch } from '../src/background/managed-watch-open.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { reconcileManagedWatchesOnStartup } from '../src/background/managed-watch-startup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerAutomationSettingsHandlers } from '../src/background/service-worker-automation-settings.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { createServiceWorkerFarmingAutomationRuntime } from '../src/background/service-worker-farming-automation.ts';
import { assembleServiceWorkerFarmingAutomation } from '../src/background/service-worker-farming-automation-assembly.ts';
import { bindCampaignEvidenceAccount } from '../src/background/session-account-evidence.ts';
import {
  loadTimingState,
  setTimingSaveDebounceMsForTests,
} from '../src/background/timing-state-persistence.ts';
import { selectMonitorDrop } from '../src/monitor/selected-drop.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import { createUserStatusModel } from '../src/shared/user-status.ts';
import { toSlug } from '../src/shared/utils.ts';
import type { AppState, DropsSnapshot, TwitchGame } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';
import { createQueueAvailabilityReconciler } from './support/queue-progression.ts';
import { createQueuedFarmingSession } from './support/queued-farming-session.ts';
import { required } from './support/required.ts';

const url = 'https://www.twitch.tv/test_streamer';
function runningState() {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.manualQueueAuthorized = true;
  state.appState.farmingSessionOrigin = 'manual';
  state.appState.watchTransportPreference = 'managed-tab';
  state.appState.selectedGame = createGame();
  state.appState.activeStreamer = createStreamer({ name: 'test_streamer' });
  state.appState.tabId = 20;
  return state;
}

function browserEventsFor(
  state: ReturnType<typeof runningState>,
  categoryOverride?: string,
  hasDropsSignal = true,
  acceptsHeartbeat = false,
) {
  const gamesByChannel = new Map<string, TwitchGame>();
  chrome.tabs.sendMessage = async (_tabId, message: { type: string }) =>
    message.type === 'PREPARE_STREAM_PLAYBACK'
      ? { isPlaybackReady: true, userInteractionRequired: false }
      : {};
  return createServiceWorkerBrowserEvents(state, {
    ensureContentScriptOnTab: async () => {},
    fetchStreamContext: async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      const channelName = new URL(tab.url ?? url).pathname.slice(1);
      const pending = state.appState.pendingWatchTarget;
      const game =
        pending?.channelName === channelName
          ? pending.game
          : (gamesByChannel.get(channelName) ?? state.appState.selectedGame);
      if (game) gamesByChannel.set(channelName, game);
      return {
        channelName,
        categorySlug: categoryOverride ?? game?.categorySlug ?? toSlug(game?.name ?? ''),
        categoryLabel: categoryOverride ?? game?.name ?? '',
        streamTitle: 'Drops enabled',
        titleContainsDrops: true,
        pageUrl: tab.url ?? url,
        isLive: true,
        isPlaybackReady: true,
        hasDropsSignal,
      };
    },
    heartbeat: async () => ({ accepted: acceptsHeartbeat }),
    notify: async () => {},
    notifyQueueComplete: async () => {},
    clearQueueCompleteNotification: async () => {},
  });
}

type ManagedOwnership = Extract<WatchOwnershipV1, { kind: 'managed-tab' }>;
type ManagedWatchSubject = {
  readonly mocks: ReturnType<typeof setupChromeMocks>;
  readonly tabs: ReturnType<typeof installManagedWatchPages>;
  readonly state: ReturnType<typeof runningState>;
  readonly browserEvents: ReturnType<typeof browserEventsFor>;
  readonly incumbent: ManagedOwnership;
};

async function withManagedIncumbent(
  run: (subject: ManagedWatchSubject) => Promise<void>,
  acceptsHeartbeat = false,
): Promise<void> {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const state = runningState();
    const browserEvents = browserEventsFor(state, undefined, true, acceptsHeartbeat);
    await browserEvents.watchTransport.start(createStreamer({ name: 'first_streamer' }));
    const incumbent = browserEvents.watchTransport.currentOwnership();
    expect(incumbent?.kind).toBe('managed-tab');
    if (incumbent?.kind !== 'managed-tab') throw new Error('Expected managed ownership');
    state.appState.availableGames = [
      required(state.appState.selectedGame),
      createGame({
        id: nextTarget.gameId,
        campaignId: nextTarget.campaignId,
        name: 'Next Game',
        categorySlug: nextTarget.categorySlug,
      }),
    ];
    await run({ mocks, tabs, state, browserEvents, incumbent });
  } finally {
    mocks.teardown();
  }
}

function automationBrowserFor(
  browserEvents: ReturnType<typeof browserEventsFor>,
  isPlaybackReady: boolean,
  ownershipToken: string,
  userInteractionRequired = !isPlaybackReady,
) {
  chrome.tabs.sendMessage = async (_tabId: number, message: { type: string }) =>
    message.type === 'PREPARE_STREAM_PLAYBACK' ? { isPlaybackReady, userInteractionRequired } : {};
  return createFarmingAutomationBrowser({
    watchRuntime: browserEvents.watchTransport,
    watch: {
      tablessEnabled: true,
      heartbeat: async () => ({ accepted: true }),
      waitForTabComplete: async () => {},
      preparePlayback: browserEvents.prepareStreamPlayback,
      probeManaged: async () => ({ accepted: true, sameChannel: true, sameGame: true }),
    },
    getManualStreamContext: async () => null,
    createOwnershipToken: () => ownershipToken,
  });
}

const nextTarget = {
  gameId: 'next-game',
  campaignId: 'next-campaign',
  categorySlug: 'next-game',
  channelName: 'second_streamer',
};

test.each(['ending-soonest', 'priority-list-only'] as const)(
  '%s favorite preemption and later favorite changes reuse the ready native farming tab',
  async (priorityMode) => {
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    try {
      const now = Date.now();
      const games = ['Rainbow Six', 'Albion'].map((name, index) =>
        createGame({
          id: toSlug(name),
          name,
          campaignId: toSlug(name),
          categorySlug: toSlug(name),
          dropCount: 1,
          endsAt: new Date(now + (index === 0 ? 120 : 60) * 60_000).toISOString(),
          rewardSummary: { completion: 'farmable', remainderReasons: [] },
        }),
      );
      const rainbow = required(games[0]);
      const albion = required(games[1]);
      const drops = games.map((game) =>
        createDrop({
          id: `reward-${game.id}`,
          gameId: game.id,
          gameName: game.name,
          campaignId: game.campaignId,
          requiredMinutes: 10,
        }),
      );
      const state = runningState();
      const session = { oauthToken: 'oauth', userId: '123', deviceId: 'device', uuid: 'uuid' };
      state.twitchSessionCache = session;
      Object.assign(state.appState, {
        selectedGame: rainbow,
        queue: [rainbow],
        availableGames: games,
        allDrops: drops,
        pendingDrops: [required(drops[0])],
        currentDrop: required(drops[0]),
        autoStartFavoriteGames: true,
        campaignPriorityMode: priorityMode,
        favoriteGames: [{ gameId: albion.id, lastKnownName: albion.name, addedAt: now }],
      });
      state.cachedDropsSnapshot = drops;
      const events = browserEventsFor(state);
      mocks.chrome.tabs.sendMessage = async (tabId, message) => {
        if (message.type !== 'PREPARE_STREAM_PLAYBACK') return {};
        required(tabs.pages.get(tabId)).playing = true;
        return { isPlaybackReady: true, userInteractionRequired: false };
      };
      await events.watchTransport.start(createStreamer({ name: 'rainbow-six_streamer' }));
      const incumbent = events.watchTransport.currentOwnership();
      if (incumbent?.kind !== 'managed-tab') throw new Error('Expected managed incumbent');
      const browser = createFarmingAutomationBrowser({
        watchRuntime: events.watchTransport,
        getManualStreamContext: async () => null,
        watch: {
          tablessEnabled: true,
          heartbeat: async () => ({ accepted: false }),
          waitForTabComplete: async () => {},
          preparePlayback: events.prepareStreamPlayback,
          probeManaged: async (ownership, target) => {
            const page = required(tabs.pages.get(ownership.tabId));
            const channel = new URL(page.url).pathname.slice(1);
            const sameChannel = channel === target.channelName;
            const sameGame = channel === `${target.gameId}_streamer`;
            return { accepted: page.playing === true && sameChannel && sameGame, sameChannel, sameGame };
          },
        },
      });
      const persistence = createChromeFarmingAutomationPersistence({
        state,
        getSessionRevision: () => String(currentFarmingSessionEpoch(state)),
        broadcast: () => {},
      });
      const twitch = createFarmingAutomationTwitchAdapter({
        loadSession: async () => session,
        fetchCampaignSnapshot: async () => ({
          games,
          drops,
          updatedAt: Date.now(),
          campaignsVerified: true,
          inventoryVerified: true,
        }),
        campaignSnapshotIncludesInventory: () => true,
        fetchDirectoryStreamers: async (game) => ({
          streamers: [createStreamer({ name: `${game.id}_streamer` })],
          languageFilterApplied: false,
        }),
      });
      const automation = createFarmingAutomation({
        state,
        reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
        persistence,
        browser,
        twitch,
        random: () => 0,
      });
      const fresh = await twitch.refresh();
      expect(fresh.kind).toBe('ready');
      if (fresh.kind !== 'ready') throw new Error('Expected ready Twitch fixture');
      expect(fresh.snapshot.games.map((game) => [game.id, game.rewardSummary?.completion])).toEqual([
        ['albion', 'farmable'],
        ['rainbow-six', 'farmable'],
      ]);
      const expectReadyCampaign = async (game: TwitchGame) => {
        expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
        expect(state.appState.activeStreamer?.name).toBe(`${game.id}_streamer`);
        expect(state.appState.currentDrop?.campaignId).toBe(game.campaignId);
        expect(state.appState.tabId).toBe(incumbent.tabId);
        expect(events.watchTransport.currentOwnership()).toMatchObject({ tabId: incumbent.tabId });
        expect(tabs.pages.get(incumbent.tabId)).toMatchObject({
          url: `https://www.twitch.tv/${game.id}_streamer`,
          playing: true,
          active: false,
        });
        expect((await events.watchTransport.tick()).isHealthy).toBe(true);
        expect(mocks.storage.local._store.get('appState')).toMatchObject({
          selectedGame: { campaignId: game.campaignId },
          activeStreamer: { name: `${game.id}_streamer` },
          tabId: incumbent.tabId,
          pendingWatchTarget: null,
          watchHealth: { isHealthy: true },
        });
        expect(tabs.created).toEqual([incumbent.tabId]);
        expect(tabs.removed).toEqual([]);
      };
      expect(await automation.request('campaign-refresh')).toMatchObject({
        kind: 'started',
        campaignKey: gameKey(albion),
        transition: 'preemption',
      });
      await expectReadyCampaign(albion);
      const navigationCount = tabs.updated.filter((update) => update.properties.url !== undefined).length;
      required(drops[1]).currentMinutes = 5;
      required(drops[1]).progress = 50;
      projectDropsSnapshot(
        state,
        { games, drops, updatedAt: Date.now(), campaignsVerified: true, inventoryVerified: true },
        'campaign-authoritative',
      );
      expect(await automation.request('campaign-refresh')).toEqual({
        kind: 'unchanged',
        reason: 'already-farming-best-campaign',
      });
      await expectReadyCampaign(albion);
      expect(state.appState.currentDrop?.currentMinutes).toBe(5);
      expect(tabs.updated.filter((update) => update.properties.url !== undefined)).toHaveLength(
        navigationCount,
      );
      for (const [game, minutes] of [
        [rainbow, 30],
        [albion, 15],
      ] as const) {
        game.endsAt = new Date(now + minutes * 60_000).toISOString();
        state.appState.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: now }];
        expect(await automation.request('user-request')).toMatchObject({
          kind: 'started',
          campaignKey: gameKey(game),
          transition: 'preemption',
        });
        await expectReadyCampaign(game);
      }
    } finally {
      mocks.teardown();
    }
  },
);

test('a failed hidden-mode switch preserves the working managed watch', async () => {
  await withManagedIncumbent(async ({ state, browserEvents, incumbent }) => {
    const target = browserEvents.watchTransport.currentTarget();
    const settings = createServiceWorkerAutomationSettingsHandlers(state, {
      browserEvents,
      stateLifecycle: { trackActivity: async () => {} },
      automation: {
        request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
        suppressCampaignUntilRefresh: async () => 'suppressed',
      },
    });
    await settings.handleSetWatchTransportMode({ mode: 'tabless' });
    expect(state.appState.watchTransportPreference).toBe('tabless');
    expect(browserEvents.watchTransport.currentTarget()).toEqual(target);
    expect(browserEvents.watchTransport.currentOwnership()).toEqual(incumbent);
    expect(state.appState.watchHealth?.isHealthy).toBe(true);
  });
});

test.each(['playback-failed', 'cancelled'] as const)(
  'initial automation %s preparation retains its native tab for the ready retry',
  async (outcome) => {
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    try {
      const userPage = tabs.add('https://example.org/keep-window');
      const state = createServiceWorkerState();
      state.appState.availableGames = [
        createGame({
          id: nextTarget.gameId,
          campaignId: nextTarget.campaignId,
          name: 'Next Game',
          categorySlug: nextTarget.categorySlug,
        }),
      ];
      const events = browserEventsFor(state);
      let current = true;
      let ready = false;
      mocks.chrome.tabs.sendMessage = async (tabId, message) => {
        if (message.type !== 'PREPARE_STREAM_PLAYBACK') return {};
        required(tabs.pages.get(tabId)).playing = ready;
        if (!ready && outcome === 'cancelled') current = false;
        return { isPlaybackReady: ready, userInteractionRequired: false };
      };
      const automationBrowser = createFarmingAutomationBrowser({
        watchRuntime: events.watchTransport,
        getManualStreamContext: async () => null,
        watch: {
          tablessEnabled: true,
          heartbeat: async () => ({ accepted: false }),
          waitForTabComplete: async () => {},
          preparePlayback: events.prepareStreamPlayback,
          probeManaged: async (ownership, target) => {
            const page = required(tabs.pages.get(ownership.tabId));
            const sameChannel = new URL(page.url).pathname.slice(1) === target.channelName;
            return { accepted: page.playing === true && sameChannel, sameChannel, sameGame: true };
          },
        },
      });
      const initial = await automationBrowser.watch.prepare(nextTarget, 'managed-tab', () => current, true);
      expect(initial.kind).toBe('failed');
      const initialTabId = required(tabs.created[0]);
      const retainedBeforeRetry = tabs.pages.has(initialTabId);
      ready = true;
      current = true;
      const retry = await automationBrowser.watch.prepare(
        { ...nextTarget, channelName: 'third_streamer' },
        'managed-tab',
        () => current,
        true,
      );
      expect(retry.kind).toBe('prepared');
      if (retry.kind !== 'prepared') throw new Error('Expected ready retry');
      expect({
        retainedBeforeRetry,
        created: tabs.created,
        removed: tabs.removed,
        ownership: retry.watch.ownership,
      }).toMatchObject({
        retainedBeforeRetry: true,
        created: [initialTabId],
        removed: [],
        ownership: { kind: 'managed-tab', tabId: initialTabId, expectedChannel: 'third_streamer' },
      });
      expect(tabs.pages.get(initialTabId)).toMatchObject({
        url: 'https://www.twitch.tv/third_streamer',
        playing: true,
      });
      expect(userPage.url).toBe('https://example.org/keep-window');
      expect(retry.watch.promote().kind).toBe('promoted');
    } finally {
      mocks.teardown();
    }
  },
);

test.each(['ready', 'failed'] as const)(
  'native automatic %s replacement publishes pending playback and suspends failed navigation',
  async (outcome) => {
    await withManagedIncumbent(async ({ mocks, tabs, state, browserEvents, incumbent }) => {
      const next = createGame({
        id: nextTarget.gameId,
        name: 'Next Game',
        campaignId: nextTarget.campaignId,
        categorySlug: nextTarget.categorySlug,
      });
      state.appState.availableGames = [required(state.appState.selectedGame), next];
      const drop = createDrop({ requiredMinutes: 60, currentMinutes: 10, progress: 16 });
      state.appState.currentDrop = drop;
      state.appState.pendingDrops = [drop];
      required(tabs.pages.get(incumbent.tabId)).playing = true;
      const broadcasts: AppState[] = [];
      mocks.chrome.runtime.sendMessage = async (message) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'UPDATE_STATE'
        )
          broadcasts.push(structuredClone(state.appState));
        return undefined;
      };
      const boundaries: AppState[] = [];
      mocks.chrome.tabs.sendMessage = async (tabId, message) => {
        if (message.type !== 'PREPARE_STREAM_PLAYBACK') return {};
        boundaries.push(structuredClone(state.appState));
        required(tabs.pages.get(tabId)).playing = outcome === 'ready';
        return { isPlaybackReady: outcome === 'ready', userInteractionRequired: false };
      };
      const adapter = createFarmingAutomationBrowser({
        watchRuntime: browserEvents.watchTransport,
        getManualStreamContext: async () => null,
        watch: {
          tablessEnabled: true,
          heartbeat: async () => ({ accepted: false }),
          waitForTabComplete: async () => {},
          preparePlayback: browserEvents.prepareStreamPlayback,
          probeManaged: async (ownership, target) => {
            const page = required(tabs.pages.get(ownership.tabId));
            const sameChannel = new URL(page.url).pathname.slice(1) === target.channelName;
            return { accepted: page.playing === true && sameChannel, sameChannel, sameGame: true };
          },
        },
      });
      const preparation = await adapter.watch.prepare(nextTarget, 'managed-tab');
      const during = required(boundaries[0]);
      if (outcome === 'failed') {
        expect({
          preparation: preparation.kind,
          playing: tabs.pages.get(incumbent.tabId)?.playing,
          activeStreamer: state.appState.activeStreamer,
          healthy: state.appState.watchHealth?.isHealthy,
          pending: state.appState.pendingWatchTarget,
        }).toEqual({
          preparation: 'failed',
          playing: false,
          activeStreamer: null,
          healthy: false,
          pending: null,
        });
      }
      const popup = createUserStatusModel({
        state: during,
        runtimeMode: 'running',
        currentAutomatableDrop: during.currentDrop,
        recoveryNow: Date.now(),
      });
      const pendingBroadcasts = broadcasts.filter((snapshot) => snapshot.pendingWatchTarget !== null);
      expect({
        pending: during.pendingWatchTarget,
        activeStreamer: during.activeStreamer,
        watchHealth: during.watchHealth,
        popup: { label: popup.label, subject: popup.subject, progressState: popup.progressState },
        monitorDrop: selectMonitorDrop(during),
        published: pendingBroadcasts.length > 0,
      }).toMatchObject({
        pending: { game: { campaignId: next.campaignId }, channelName: nextTarget.channelName },
        activeStreamer: null,
        watchHealth: null,
        popup: { label: 'Switching to', subject: 'Next Game', progressState: 'waiting' },
        monitorDrop: null,
        published: true,
      });
      for (const snapshot of pendingBroadcasts) {
        expect(selectMonitorDrop(snapshot)).toBeNull();
        expect(
          createUserStatusModel({
            state: snapshot,
            runtimeMode: 'running',
            currentAutomatableDrop: snapshot.currentDrop,
            recoveryNow: Date.now(),
          }).label,
        ).toBe('Switching to');
      }
      expect(tabs.pages.get(incumbent.tabId)?.url).toBe('https://www.twitch.tv/second_streamer');
      expect(tabs.created).toEqual([incumbent.tabId]);
      expect(tabs.removed).toEqual([]);
      if (outcome === 'ready') {
        expect(preparation.kind).toBe('prepared');
        if (preparation.kind !== 'prepared') throw new Error('Expected prepared replacement');
        await preparation.watch.dispose();
      } else {
        expect(preparation.kind).toBe('failed');
      }
    });
  },
);

test('runtime manual invalidation cancels an in-flight automatic refresh before streamer acquisition', async () => {
  const mocks = setupChromeMocks();
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  try {
    const state = createServiceWorkerState();
    const game = createGame({
      campaignId: 'favorite-campaign',
      categorySlug: 'test-game',
      endsAt: '2030-08-04T12:00:00.000Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.autoStartFavoriteGames = true;
    state.appState.favoriteGames = [{ gameId: game.id, lastKnownName: game.name, addedAt: 1 }];
    const session = { oauthToken: 'oauth', userId: '123', deviceId: 'device', uuid: 'uuid' };
    state.twitchSessionCache = session;
    const snapshot = {
      games: [game],
      drops: [createDrop({ campaignId: game.campaignId, requiredMinutes: 60 })],
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    let directoryReads = 0;
    const runtime = createServiceWorkerFarmingAutomationRuntime(state, {
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      browserEvents: browserEventsFor(state),
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => session,
        fetchDropsSnapshot: async () => {
          entered.resolve();
          await release.promise;
          return snapshot;
        },
        getLatestProgressSnapshot: () => null,
        fetchInventorySnapshot: async () => snapshot,
        fetchDirectoryStreamers: async () => {
          directoryReads++;
          return Object.assign([], { languageFilterApplied: false });
        },
        fetchStreamContext: async () => null,
        heartbeat: async () => ({ accepted: false }),
      },
    });
    await runtime.initialize();
    const evaluating = runtime.automation.request('campaign-refresh');
    await entered.promise;
    runtime.automation.invalidate?.();
    release.resolve();
    expect(await evaluating).toEqual({ kind: 'unchanged', reason: 'superseded-by-state-change' });
    expect(directoryReads).toBe(0);
    expect(state.appState.isRunning).toBe(false);
  } finally {
    release.resolve();
    mocks.teardown();
  }
});

test.each([true, false])(
  'actual automation assembly restores ordinary managed watch after same-version browser restart without creating a tab (Drops label: %p)',
  async (hasDropsSignal) => {
    setTimingSaveDebounceMsForTests(0);
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    try {
      const page = tabs.add(url);
      await managedWatchMarker.write(page.id, 'assembly-owned', url);
      tabs.pages.delete(page.id);
      page.id = 83;
      tabs.pages.set(83, page);
      mocks.storage.session._store.clear();
      const state = runningState();
      state.appState.currentDrop = createDrop({ requiredMinutes: 60, currentMinutes: 25, progress: 42 });
      const browserEvents = browserEventsFor(state, undefined, hasDropsSignal);
      let creates = 0;
      mocks.chrome.tabs.create = async () => {
        creates++;
        throw new Error('Must restore before acquire');
      };
      await prepareBrowserSessionResume(state);
      await assembleServiceWorkerFarmingAutomation(state, {
        reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
        browserEvents,
        startMonitoring: () => {},
        twitchGateway: {
          ensureTwitchSession: async () => null,
          fetchDirectoryStreamers: async () => Object.assign([], { languageFilterApplied: false }),
          fetchDropsSnapshot: async () => null,
          getLatestProgressSnapshot: () => null,
          fetchInventorySnapshot: async () => null,
          fetchStreamContext: async () => null,
          heartbeat: async () => ({ accepted: false }),
        },
      });
      expect(browserEvents.watchTransport.currentOwnership()).toEqual({
        kind: 'managed-tab',
        tabId: 83,
        ownershipToken: 'assembly-owned',
        expectedChannel: 'test_streamer',
      });
      expect(state.appState.tabId).toBe(83);
      expect(state.appState.watchHealth?.status).toBe(hasDropsSignal ? 'healthy' : 'degraded');
      expect(state.appState.activeStreamer?.name).toBe('test_streamer');
      expect(state.appState.recoveryReason).toBeNull();
      expect(browserEvents.watchTransport.hasViableManagedWatch?.()).toBe(true);
      expect(creates).toBe(0);
      expect(tabs.removed).toEqual([]);
      await browserEvents.watchTransport.stop();
      expect(page.url).toBe(url);
      expect(browserEvents.watchTransport.currentOwnership()).toEqual({
        kind: 'managed-tab',
        tabId: 83,
        ownershipToken: 'assembly-owned',
        expectedChannel: 'test_streamer',
      });
    } finally {
      setTimingSaveDebounceMsForTests(null);
      mocks.teardown();
    }
  },
);

test.each(['wrong-channel', 'wrong-game', 'missing-tab'] as const)(
  'startup discards stale healthy state after rejecting a %s owned watch',
  async (mismatch) => {
    setTimingSaveDebounceMsForTests(0);
    const mocks = setupChromeMocks();
    const tabs = installManagedWatchPages(mocks);
    try {
      const page = tabs.add(mismatch === 'wrong-channel' ? 'https://www.twitch.tv/previous_streamer' : url);
      await managedWatchMarker.write(page.id, 'mismatched-owned', page.url);
      if (mismatch === 'missing-tab') tabs.pages.delete(page.id);
      const state = runningState();
      const selected = state.appState.selectedGame;
      state.appState.queue = selected ? [selected] : [];
      state.appState.watchHealth = {
        mode: 'managed-tab',
        status: 'healthy',
        reason: 'heartbeat',
        isHealthy: true,
        consecutiveFailures: 0,
        consecutiveStalls: 0,
        progress: 10,
        shouldFallback: false,
        checkedAt: 1,
      };
      const browserEvents = browserEventsFor(state, mismatch === 'wrong-game' ? 'another-game' : undefined);
      await assembleServiceWorkerFarmingAutomation(state, {
        reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
        browserEvents,
        startMonitoring: () => {},
        twitchGateway: {
          ensureTwitchSession: async () => null,
          fetchDirectoryStreamers: async () => Object.assign([], { languageFilterApplied: false }),
          fetchDropsSnapshot: async () => null,
          getLatestProgressSnapshot: () => null,
          fetchInventorySnapshot: async () => null,
          fetchStreamContext: async () => null,
          heartbeat: async () => ({ accepted: false }),
        },
      });
      expect(browserEvents.watchTransport.currentTarget()).toBeNull();
      expect(state.appState.activeStreamer).toBeNull();
      expect(state.appState.watchHealth).toBeNull();
      expect(state.appState.tabId).toBeNull();
      expect(state.appState.selectedGame).toEqual(selected);
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.manualQueueAuthorized).toBe(true);
      expect(state.appState.recoveryReason).toBe('open-failed');
      expect(mocks.storage.local._store.get('appState')).toMatchObject({
        activeStreamer: null,
        watchHealth: null,
        tabId: null,
      });
      expect(tabs.removed).toEqual([]);
    } finally {
      setTimingSaveDebounceMsForTests(null);
      mocks.teardown();
    }
  },
);

test('queued Play probes an authorized channel missing from directory results through production assembly wiring', async () => {
  setTimingSaveDebounceMsForTests(0);
  const mocks = setupChromeMocks();
  try {
    const state = createServiceWorkerState();
    const queued: TwitchGame = createGame({
      campaignId: 'queued-campaign',
      endsAt: '2030-08-04T12:00:00.000Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
      allowedChannels: ['restricted-channel'],
    });
    state.appState.queue = [queued];
    state.appState.isRunning = true;
    state.appState.queueEntryMetadataByKey = {
      [gameKey(queued)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
    };
    const stale: DropsSnapshot = {
      games: [createGame({ campaignId: 'stale-campaign' })],
      drops: [],
      campaignsVerified: false,
      inventoryVerified: false,
      updatedAt: Date.now() - 10_000,
    };
    const fresh: DropsSnapshot = {
      games: [queued],
      drops: [createDrop({ gameId: queued.id, campaignId: queued.campaignId, requiredMinutes: 60 })],
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    let progressiveReads = 0;
    let freshReads = 0;
    let directoryReads = 0;
    const probedChannels: string[] = [];
    const farming = createQueuedFarmingSession(state, {
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      browserEvents: browserEventsFor(state),
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => {
          const session = {
            oauthToken: 'oauth',
            userId: '123',
            deviceId: 'device',
            uuid: 'uuid',
          };
          state.twitchSessionCache = session;
          return session;
        },
        fetchDirectoryStreamers: async () => {
          directoryReads++;
          return Object.assign([], { languageFilterApplied: false });
        },
        fetchDropsSnapshot: async () => {
          freshReads++;
          return { ...fresh, updatedAt: Date.now() };
        },
        getLatestProgressSnapshot: () => {
          progressiveReads++;
          return stale;
        },
        fetchInventorySnapshot: async () => null,
        fetchStreamContext: async () => null,
        heartbeat: async () => ({ accepted: false }),
        probeStreamInfo: async (channel) => {
          probedChannels.push(channel);
          return {
            kind: 'live',
            streamer: { id: '42', name: channel, displayName: channel, isLive: true },
            categoryLabel: 'Test Game',
          };
        },
      },
    });

    const result = await farming.handleStartQueuedCampaign(gameKey(queued));
    await farming.checkDropProgress();

    expect(result).toEqual({ success: true });
    expect(state.appState.recoveryReason).toBe('directory-unavailable');
    expect(progressiveReads).toBe(0);
    expect(freshReads).toBe(1);
    expect(directoryReads).toBe(1);
    expect(probedChannels).toEqual(['restricted-channel']);
    expect(state.appState.selectedGame?.campaignId).toBe(queued.campaignId);
    expect(state.appState.queue).toEqual([queued]);
  } finally {
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  }
});

test('queued Play persists a newly verified Twitch cooldown while authorizing scheduled recovery', async () => {
  const mocks = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
  try {
    const state = createServiceWorkerState();
    const queued: TwitchGame = createGame({
      campaignId: 'cooldown-campaign',
      endsAt: '2030-08-04T12:00:00.000Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
      allowedChannels: ['restricted-channel'],
    });
    state.appState.queue = [queued];
    state.appState.isRunning = true;
    state.appState.queueEntryMetadataByKey = {
      [gameKey(queued)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
    };
    const fresh: DropsSnapshot = {
      games: [queued],
      drops: [createDrop({ gameId: queued.id, campaignId: queued.campaignId, requiredMinutes: 60 })],
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    let probeCalls = 0;
    const farming = createQueuedFarmingSession(state, {
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      browserEvents: browserEventsFor(state),
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => {
          const session = { oauthToken: 'oauth', userId: '123', deviceId: 'device', uuid: 'uuid' };
          state.twitchSessionCache = session;
          return session;
        },
        fetchDirectoryStreamers: async () => Object.assign([], { languageFilterApplied: false }),
        fetchDropsSnapshot: async () => ({ ...fresh, updatedAt: Date.now() }),
        getLatestProgressSnapshot: () => null,
        fetchInventorySnapshot: async () => null,
        fetchStreamContext: async () => null,
        heartbeat: async () => ({ accepted: false }),
        probeStreamInfo: async () => {
          probeCalls++;
          state.apiBackoffUntil = Date.now() + 120_000;
          state.apiRetryAfterVerifiedAt = Date.now();
          return { kind: 'unavailable', cause: new Error('Twitch API rate limit (HTTP 429)') };
        },
      },
    });

    const result = await farming.handleStartQueuedCampaign(gameKey(queued));
    await farming.checkDropProgress();
    const restarted = createServiceWorkerState();
    await loadTimingState(restarted);

    expect(result?.success).toBe(true);
    expect(probeCalls).toBe(1);
    expect(state.apiBackoffUntil).toBeGreaterThan(Date.now() + 60_000);
    expect(restarted.apiBackoffUntil).toBe(state.apiBackoffUntil);
    expect(restarted.apiBackoffUntil).toBeGreaterThan(Date.now() + 60_000);
    expect(restarted.apiRetryAfterVerifiedAt).toBeGreaterThan(0);
  } finally {
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  }
});

test('queued Play cancels safely when account binding clears previous account campaign evidence', async () => {
  const mocks = setupChromeMocks();
  setTimingSaveDebounceMsForTests(0);
  try {
    const state = createServiceWorkerState();
    const incumbent: TwitchGame = createGame({
      campaignId: 'incumbent-campaign',
      endsAt: '2030-08-04T12:00:00.000Z',
      allDropsCompleted: true,
      rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
    });
    const queued: TwitchGame = createGame({
      id: 'queued-game',
      name: 'Queued Game',
      campaignId: 'queued-campaign',
      endsAt: '2030-08-05T12:00:00.000Z',
      rewardSummary: { completion: 'farmable', remainderReasons: [] },
    });
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.selectedGame = incumbent;
    state.appState.queue = [incumbent, queued];
    state.appState.queueEntryMetadataByKey = {
      [gameKey(incumbent)]: { source: 'manual', addedAt: 1, reason: 'user-added' },
      [gameKey(queued)]: { source: 'manual', addedAt: 2, reason: 'user-added' },
    };
    state.appState.availableGames = [incumbent, queued];
    state.appState.acquiredCampaignIds = ['incumbent-campaign'];
    state.appState.campaignEvidenceUserId = 'old-account';
    state.twitchSessionCache = null;
    const fresh: DropsSnapshot = {
      games: [{ ...queued, rewardSummary: { completion: 'farmable', remainderReasons: [] } }],
      drops: [],
      campaignsVerified: true,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
    let directoryReads = 0;
    const farming = createQueuedFarmingSession(state, {
      reconcileQueueAvailability: createQueueAvailabilityReconciler(state),
      browserEvents: browserEventsFor(state),
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => {
          const session = {
            oauthToken: 'oauth',
            userId: 'new-account',
            deviceId: 'device',
            uuid: 'uuid',
          };
          await bindCampaignEvidenceAccount(state, session.userId);
          state.twitchSessionCache = session;
          return session;
        },
        fetchDirectoryStreamers: async () => {
          directoryReads++;
          return Object.assign([], { languageFilterApplied: false });
        },
        fetchDropsSnapshot: async () => ({ ...fresh, updatedAt: Date.now() }),
        getLatestProgressSnapshot: () => null,
        fetchInventorySnapshot: async () => null,
        fetchStreamContext: async () => null,
        heartbeat: async () => ({ accepted: false }),
      },
    });

    const result = await farming.handleStartQueuedCampaign(gameKey(queued));
    await farming.checkDropProgress();

    expect(result).toEqual({ success: true });
    expect(directoryReads).toBe(0);
    expect(state.appState.selectedGame?.campaignId).toBe('queued-campaign');
    expect(state.appState.isRunning).toBe(true);
    expect(state.appState.queue.map((game) => game.campaignId)).toEqual([
      'queued-campaign',
      'incumbent-campaign',
    ]);
    expect(state.appState.acquiredCampaignIds).toEqual([]);
  } finally {
    setTimingSaveDebounceMsForTests(null);
    mocks.teardown();
  }
});

test('stopped farming keeps its owned tab available for the next session after worker restart', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const page = tabs.add('https://www.twitch.tv/first_streamer');
    await managedWatchMarker.write(page.id, 'stopped-owned', page.url);
    const state = runningState();
    state.appState.isRunning = false;
    state.appState.activeStreamer = null;
    state.appState.tabId = null;
    const browserEvents = browserEventsFor(state);

    const ownership = await reconcileManagedWatchesOnStartup(state, null);
    if (!ownership) throw new Error('Expected the stopped managed watch to be retained');
    expect(ownership).toEqual({
      kind: 'managed-tab',
      tabId: page.id,
      ownershipToken: 'stopped-owned',
      expectedChannel: 'first_streamer',
    });
    expect(await browserEvents.watchTransport.restore(ownership)).toBe(true);
    await browserEvents.watchTransport.start(createStreamer({ name: 'second_streamer' }));

    expect(browserEvents.watchTransport.currentOwnership()).toMatchObject({
      kind: 'managed-tab',
      tabId: page.id,
      expectedChannel: 'second_streamer',
    });
    expect(page.url).toBe('https://www.twitch.tv/second_streamer');
    expect(tabs.pages.size).toBe(1);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('startup retains a unique managed tab even when the queued channel changed', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const page = tabs.add('https://www.twitch.tv/previous_streamer');
    await managedWatchMarker.write(page.id, 'previous-owned', page.url);
    const state = runningState();
    expect(await reconcileManagedWatchesOnStartup(state, null)).toMatchObject({
      tabId: page.id,
      expectedChannel: 'previous_streamer',
    });
    expect(state.appState.tabId).toBe(page.id);
    expect(tabs.created).toEqual([]);
    expect(tabs.updated).toEqual([]);
    expect(tabs.removed).toEqual([]);
  } finally {
    mocks.teardown();
  }
});

test('switching to tabless watching retains the registered tab for managed recovery', async () => {
  await withManagedIncumbent(async ({ tabs, browserEvents, incumbent }) => {
    const adapter = automationBrowserFor(browserEvents, true, 'next-owned');
    const prepared = await adapter.watch.prepare(nextTarget, 'tabless');
    if (prepared.kind !== 'prepared') throw new Error('Expected a tabless candidate');
    prepared.watch.promote();
    await adapter.watch.release(incumbent);
    expect((await listManagedWatches()).some((item) => item.tabId === incumbent.tabId)).toBe(true);
    const nextManaged = await adapter.watch.prepare(nextTarget, 'managed-tab');
    expect(nextManaged.kind).toBe('prepared');
    if (nextManaged.kind === 'prepared')
      expect(nextManaged.watch.ownership).toMatchObject({ tabId: incumbent.tabId });
    expect(tabs.created).toHaveLength(1);
    expect(tabs.removed).toEqual([]);
  }, true);
});

test('managed farming reuses the same tab when the streamer and campaign change', async () => {
  await withManagedIncumbent(async ({ state, browserEvents, incumbent, tabs }) => {
    state.appState.selectedGame = createGame({
      id: 'next-game',
      campaignId: 'next-campaign',
      name: 'Next Game',
    });
    await browserEvents.watchTransport.start(createStreamer({ name: 'second_streamer' }));
    const secondOwnership = browserEvents.watchTransport.currentOwnership();

    expect(secondOwnership).toMatchObject({
      kind: 'managed-tab',
      tabId: incumbent.tabId,
      expectedChannel: 'second_streamer',
    });
    expect([...tabs.pages.values()].map((page) => ({ id: page.id, url: page.url }))).toEqual([
      { id: incumbent.tabId, url: 'https://www.twitch.tv/second_streamer' },
    ]);
    expect(tabs.removed).toEqual([]);
  });
});

test('managed farming does not open a second tab while the incumbent tab still exists', async () => {
  await withManagedIncumbent(async ({ mocks, tabs, browserEvents, incumbent }) => {
    mocks.storage.session._store.clear();
    tabs.pages.get(incumbent.tabId)?.storage.clear();
    await browserEvents.watchTransport.start(createStreamer({ name: 'second_streamer' }));

    expect(browserEvents.watchTransport.currentOwnership()).toEqual(incumbent);
    expect([...tabs.pages.values()].map((page) => ({ id: page.id, url: page.url }))).toEqual([
      { id: incumbent.tabId, url: 'https://www.twitch.tv/first_streamer' },
    ]);
    expect(tabs.removed).toEqual([]);
  });
});

test('managed farming creates a replacement only after the streamer tab was closed', async () => {
  await withManagedIncumbent(async ({ tabs, browserEvents, incumbent }) => {
    tabs.pages.delete(incumbent.tabId);
    await browserEvents.watchTransport.start(createStreamer({ name: 'second_streamer' }));
    const replacement = browserEvents.watchTransport.currentOwnership();

    expect(replacement).toMatchObject({
      kind: 'managed-tab',
      expectedChannel: 'second_streamer',
    });
    expect(replacement?.kind === 'managed-tab' ? replacement.tabId : null).not.toBe(incumbent.tabId);
    expect([...tabs.pages.values()].map((page) => page.url)).toEqual([
      'https://www.twitch.tv/second_streamer',
    ]);
  });
});

test('automatic campaign handoff promotes the next streamer in the existing farming tab', async () => {
  await withManagedIncumbent(async ({ tabs, browserEvents, incumbent }) => {
    const automationBrowser = automationBrowserFor(browserEvents, true, 'next-owned');
    const prepared = await automationBrowser.watch.prepare(nextTarget, 'managed-tab');
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') throw new Error('Expected prepared handoff');

    const promotion = prepared.watch.promote();
    expect(promotion).toMatchObject({
      kind: 'promoted',
      ownership: { kind: 'managed-tab', tabId: incumbent.tabId, expectedChannel: 'second_streamer' },
    });
    await automationBrowser.watch.release(incumbent);

    expect([...tabs.pages.values()].map((page) => ({ id: page.id, url: page.url }))).toEqual([
      { id: incumbent.tabId, url: 'https://www.twitch.tv/second_streamer' },
    ]);
    expect(tabs.removed).toEqual([]);
  });
});

test('failed in-place handoff retains its single tab without rolling back the URL', async () => {
  await withManagedIncumbent(async ({ tabs, browserEvents, incumbent }) => {
    const automationBrowser = automationBrowserFor(browserEvents, false, 'rejected-owned', false);

    const failed = await automationBrowser.watch.prepare(nextTarget, 'managed-tab');
    expect(failed).toMatchObject({
      kind: 'failed',
      reason: 'candidate-unavailable',
    });
    if (failed.kind !== 'failed') throw new Error('Expected failed native preparation');
    expect(failed.health?.isHealthy).toBe(false);

    expect(browserEvents.watchTransport.currentOwnership()).toEqual(incumbent);
    expect([...tabs.pages.values()].map((page) => ({ id: page.id, url: page.url }))).toEqual([
      { id: incumbent.tabId, url: 'https://www.twitch.tv/second_streamer' },
    ]);
    expect(tabs.removed).toEqual([]);
    const retry = automationBrowserFor(browserEvents, true, 'retry-owned');
    const prepared = await retry.watch.prepare(
      { ...nextTarget, channelName: 'third_streamer' },
      'managed-tab',
    );
    expect(prepared.kind).toBe('prepared');
    expect(tabs.created).toHaveLength(1);
    expect(tabs.pages.get(incumbent.tabId)?.url).toBe('https://www.twitch.tv/third_streamer');
  });
});

test('transient script failure retains manual proof for a later successful startup', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const page = tabs.add(url);
    await managedWatchMarker.write(page.id, 'retry-owned', url);
    const execute = mocks.chrome.scripting.executeScript;
    mocks.chrome.scripting.executeScript = async () => {
      throw new Error('Worker woke before page ready');
    };
    const state = runningState();
    expect(await reconcileManagedWatchesOnStartup(state, null)).toBeNull();
    expect(await listManagedWatches()).toHaveLength(1);
    mocks.chrome.scripting.executeScript = execute;
    expect(await reconcileManagedWatchesOnStartup(state, null)).toMatchObject({
      tabId: page.id,
      ownershipToken: 'retry-owned',
    });
  } finally {
    mocks.teardown();
  }
});

test('Stop during startup registry write cannot restore late ownership', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const entered = createDeferred<void>();
  const resume = createDeferred<void>();
  try {
    const page = tabs.add(url);
    await managedWatchMarker.write(page.id, 'stop-owned', url);
    const set = mocks.storage.local.set;
    mocks.storage.local.set = async (values) => {
      if ('managedWatchOwnershipV1:stop-owned' in values) {
        entered.resolve(undefined);
        await resume.promise;
      }
      await set(values);
    };
    const state = runningState();
    const restoring = reconcileManagedWatchesOnStartup(state, null);
    await entered.promise;
    await createFarmingSession(state, createFarmingSessionAdapters()).handleStopFarming();
    resume.resolve(undefined);
    expect(await restoring).toBeNull();
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.tabId).toBeNull();
    expect(page.url).toBe(url);
  } finally {
    resume.resolve(undefined);
    mocks.teardown();
  }
});

test('unproven remapped appState tab ID is cleared and never reused for a new watch', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const user = tabs.add('https://www.twitch.tv/user_choice');
    const state = runningState();
    expect(await reconcileManagedWatchesOnStartup(state, null)).toBeNull();
    expect(state.appState.tabId).toBeNull();
    const started = await openOwnedManagedWatch(
      state,
      { gameId: 'game', categorySlug: 'game', channelName: 'test_streamer' },
      async () => ({ isPlaybackReady: true }),
    );
    expect(started?.tabId).not.toBe(user.id);
    expect(user.url).toBe('https://www.twitch.tv/user_choice');
    expect(tabs.pages.has(user.id)).toBe(true);
  } finally {
    mocks.teardown();
  }
});
