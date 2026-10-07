import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { saveState } from '../src/background/state-persistence.ts';
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

describe('managed candidate replacement through real browser events', () => {
  let mocks: ReturnType<typeof setupChromeMocks>;
  beforeEach(() => {
    mocks = setupChromeMocks();
  });
  afterEach(() => mocks.teardown());

  async function fixture(candidateResult: 'failed' | 'gesture' | 'started') {
    const tabs = installManagedWatchPages(mocks);
    const games = ['smite', 'r6'].map((id) =>
      createGame({
        id,
        name: id,
        campaignId: `${id}-campaign`,
        categorySlug: id,
        rewardSummary: { completion: 'farmable', remainderReasons: [] },
      }),
    );
    const drops = games.map((game) =>
      createDrop({
        id: `${game.id}-drop`,
        gameId: game.id,
        campaignId: game.campaignId,
        progress: 17,
        currentMinutes: 10,
        requiredMinutes: 60,
      }),
    );
    const state = createMinimalState();
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'manual',
      selectedGame: games[0],
      queue: games,
      availableGames: games,
      allDrops: [drops[0]],
      pendingDrops: [drops[0]],
      currentDrop: drops[0],
      watchTransportPreference: 'managed-tab',
    });
    state.cachedDropsSnapshot = drops;
    const entered = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    mocks.chrome.tabs.sendMessage = async (tabId, message) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !('type' in message) ||
        message.type !== 'PREPARE_STREAM_PLAYBACK'
      )
        return {};
      const page = tabs.pages.get(tabId);
      const candidate = page?.url === 'https://www.twitch.tv/r6_streamer';
      if (candidate) {
        entered.resolve(tabId);
        await release.promise;
      }
      const ready = !candidate || candidateResult === 'started';
      if (page) page.playing = ready;
      return { isPlaybackReady: ready, userInteractionRequired: candidate && candidateResult === 'gesture' };
    };
    const events = createServiceWorkerBrowserEvents(state, {
      ensureContentScriptOnTab: async () => {},
      fetchStreamContext: async (tabId) => {
        const page = tabs.pages.get(tabId);
        if (!page) return null;
        const channelName = new URL(page.url).pathname.slice(1);
        const categorySlug = channelName.split('_')[0] ?? '';
        return {
          channelName,
          categorySlug,
          categoryLabel: categorySlug,
          streamTitle: 'Drops',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          isPlaybackReady: page.playing === true,
          pageUrl: page.url,
        };
      },
      heartbeat: async () => ({ accepted: false }),
      notify: async () => {},
      notifyQueueComplete: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: events.watchTransport,
        fetchDirectoryStreamersFromApi: async (game) =>
          Object.assign([createStreamer({ name: `${game.id}_streamer` })], { languageFilterApplied: true }),
        saveState,
      }),
    );
    expect((await events.watchTransport.start(createStreamer({ name: 'smite_streamer' }))).kind).toBe(
      'started',
    );
    const incumbent = events.watchTransport.currentOwnership();
    if (incumbent?.kind !== 'managed-tab') throw new Error('Expected managed incumbent');
    return { state, events, session, games, tabs, entered, release, incumbent };
  }

  for (const result of ['failed', 'gesture', 'started'] as const) {
    test(`a ${result} candidate replaces the page in the same tab without publishing an old active channel`, async () => {
      const subject = await fixture(result);
      const switching = subject.session.handleSetSelectedGame({ game: required(subject.games[1]) });
      const candidateId = await subject.entered.promise;
      try {
        expect(candidateId).toBe(subject.incumbent.tabId);
        expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe(
          'https://www.twitch.tv/r6_streamer',
        );
        expect(subject.tabs.pages.get(candidateId)?.playing).toBe(false);
        expect(subject.events.watchTransport.currentOwnership()).toEqual(subject.incumbent);
        expect(subject.state.appState.selectedGame?.campaignId).toBe('smite-campaign');
        expect(subject.state.appState.activeStreamer).toBeNull();
        expect(
          subject.tabs.navigated.some(
            (navigation) =>
              navigation.id === subject.incumbent.tabId && navigation.url.endsWith('/r6_streamer'),
          ),
        ).toBe(true);
        // Initial startup and the replacement share one tab.
        expect(
          subject.tabs.navigated.filter((navigation) => navigation.id === subject.incumbent.tabId),
        ).toHaveLength(1);
        expect(subject.tabs.updated.filter((update) => update.properties.url)).toHaveLength(1);
      } finally {
        subject.release.resolve();
      }
      const response = await switching;
      // Ownership cleanup crosses browser storage and script boundaries asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(response.success).toBe(result !== 'failed');
      expect(subject.tabs.pages).toHaveProperty('size', 1);
      expect(await listManagedWatches()).toHaveLength(1);
      if (result !== 'failed') {
        expect(subject.tabs.pages.has(subject.incumbent.tabId)).toBe(true);
        expect(subject.events.watchTransport.currentOwnership()).toMatchObject({
          tabId: candidateId,
          expectedChannel: 'r6_streamer',
        });
        expect(subject.state.appState.selectedGame?.campaignId).toBe('r6-campaign');
      } else {
        expect(subject.tabs.pages.has(candidateId)).toBe(true);
        expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe(
          'https://www.twitch.tv/r6_streamer',
        );
        expect(subject.events.watchTransport.currentOwnership()).toEqual(subject.incumbent);
        expect(subject.state.appState.activeStreamer).toBeNull();
      }
    });
  }

  test('queued Play navigates the owned tab during main-flow preparation', async () => {
    const subject = await fixture('started');
    expect(await subject.session.handleStartQueuedCampaign('campaign:r6-campaign')).toEqual({
      success: true,
    });
    expect(subject.state.appState.watchHealth).toBeNull();
    expect(subject.state.appState.activeStreamer).toBeNull();
    const checking = subject.session.checkDropProgress();
    const candidateId = await subject.entered.promise;
    try {
      expect(candidateId).toBe(subject.incumbent.tabId);
      expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe('https://www.twitch.tv/r6_streamer');
      expect(subject.tabs.pages.get(candidateId)?.playing).toBe(false);
    } finally {
      subject.release.resolve();
      await checking;
    }
    expect(subject.state.appState.activeStreamer?.name).toBe('r6_streamer');
  });

  test('a successful replacement keeps the same sole tab and window', async () => {
    const subject = await fixture('started');
    const incumbentPage = subject.tabs.pages.get(subject.incumbent.tabId);
    if (!incumbentPage) throw new Error('Expected incumbent page');
    incumbentPage.windowId = 7;
    const switching = subject.session.handleSetSelectedGame({ game: required(subject.games[1]) });
    const candidateId = await subject.entered.promise;
    subject.release.resolve();
    expect((await switching).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(subject.tabs.removed).toEqual([]);
    expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe('https://www.twitch.tv/r6_streamer');
    expect(subject.events.watchTransport.currentOwnership()).toMatchObject({
      tabId: candidateId,
      expectedChannel: 'r6_streamer',
    });
    expect(await listManagedWatches()).toHaveLength(1);
  });

  test.each(['pause', 'stop'] as const)(
    '%s during in-place preparation pauses the candidate player too',
    async (action) => {
      const subject = await fixture('started');
      await subject.session.handleStartQueuedCampaign('campaign:r6-campaign');
      const checking = subject.session.checkDropProgress();
      const id = await subject.entered.promise;
      const page = subject.tabs.pages.get(id);
      if (!page) throw new Error('Expected owned page');
      page.playing = true;
      if (action === 'pause') await subject.session.handlePauseFarming();
      else await subject.session.handleStopFarming();
      subject.release.resolve();
      await checking;
      expect(page.playing).toBe(false);
      expect(subject.tabs.pages.size).toBe(1);
      expect(subject.state.appState.isPaused).toBe(action === 'pause');
      expect(subject.state.appState.isRunning).toBe(action === 'pause');
    },
  );

  test.each(['pause', 'stop'] as const)(
    '%s pauses a failed replacement manually restarted in the retained tab',
    async (action) => {
      const subject = await fixture('failed');
      const switching = subject.session.handleSetSelectedGame({ game: required(subject.games[1]) });
      const id = await subject.entered.promise;
      subject.release.resolve();
      expect((await switching).success).toBe(false);
      expect(subject.events.watchTransport.currentOwnership()).toEqual(subject.incumbent);
      const page = subject.tabs.pages.get(id);
      if (!page) throw new Error('Expected retained replacement page');
      expect(page.url).toBe('https://www.twitch.tv/r6_streamer');
      page.playing = true;

      if (action === 'pause') await subject.session.handlePauseFarming();
      else await subject.session.handleStopFarming();

      expect(page.playing).toBe(false);
      expect(subject.tabs.pages.size).toBe(1);
      expect(subject.state.appState.isPaused).toBe(action === 'pause');
      expect(subject.state.appState.isRunning).toBe(action === 'pause');
      subject.session.stopMonitoring();
    },
  );
});
