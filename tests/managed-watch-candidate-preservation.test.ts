import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
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

describe('managed candidate preservation through real browser events', () => {
  let mocks: ReturnType<typeof setupChromeMocks>;
  beforeEach(() => {
    mocks = setupChromeMocks();
  });
  afterEach(() => mocks.teardown());

  for (const outcome of ['cancelled', 'navigation-error', 'marker-cancelled'] as const) {
    test(`host discards a provisional creation on ${outcome} before the caller receives its tab`, async () => {
      const tabs = installManagedWatchPages(mocks);
      const incumbent = tabs.add('https://www.twitch.tv/smite_streamer');
      expect(await managedWatchMarker.write(incumbent.id, 'incumbent', incumbent.url)).toBe(true);
      const host = createChromeFarmingAutomationHost(() => ({
        kind: 'managed-tab',
        tabId: incumbent.id,
        ownershipToken: 'incumbent',
        expectedChannel: 'smite_streamer',
      }));
      let current = true;
      const update = mocks.chrome.tabs.update;
      const execute = mocks.chrome.scripting.executeScript;
      mocks.chrome.tabs.update = async (tabId, properties) => {
        const configured = await update(tabId, properties);
        if (properties?.url === 'https://www.twitch.tv/r6_streamer') {
          if (outcome === 'cancelled') current = false;
          if (outcome === 'navigation-error') throw new Error('Navigation failed after starting');
        }
        return configured;
      };
      mocks.chrome.scripting.executeScript = async (options) => {
        const result = await execute(options);
        if (outcome === 'marker-cancelled' && options.target.tabId !== incumbent.id) current = false;
        return result;
      };
      const properties = {
        url: 'https://www.twitch.tv/r6_streamer',
        active: false as const,
        muted: true as const,
      };
      if (outcome === 'navigation-error')
        await expect(host.tabs.create(properties, () => current, true, true)).rejects.toThrow(
          'Navigation failed',
        );
      else expect(await host.tabs.create(properties, () => current, true, true)).toBeNull();

      expect(tabs.pages.size).toBe(1);
      expect(tabs.pages.get(incumbent.id)?.url).toBe(incumbent.url);
      expect(await listManagedWatches()).toMatchObject([
        { tabId: incumbent.id, ownershipToken: 'incumbent' },
      ]);

      mocks.chrome.tabs.update = update;
      mocks.chrome.scripting.executeScript = execute;
      current = true;
      const retried = await host.tabs.create(properties, () => current, true, true);
      expect(retried?.id).toBeNumber();
      expect(retried?.id).not.toBe(incumbent.id);
      expect(tabs.pages.get(incumbent.id)?.url).toBe('https://www.twitch.tv/smite_streamer');
    });
  }

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
    const playing = new Set<number>();
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
      if (ready) playing.add(tabId);
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
          isPlaybackReady: playing.has(tabId),
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
    return { state, events, session, games, tabs, playing, entered, release, incumbent };
  }

  for (const result of ['failed', 'gesture', 'started'] as const) {
    test(`the incumbent keeps playing during a ${result} candidate preparation`, async () => {
      const subject = await fixture(result);
      const switching = subject.session.handleSetSelectedGame({ game: subject.games[1]! });
      const candidateId = await subject.entered.promise;
      try {
        expect(candidateId).not.toBe(subject.incumbent.tabId);
        expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe(
          'https://www.twitch.tv/smite_streamer',
        );
        expect(subject.playing.has(subject.incumbent.tabId)).toBe(true);
        expect(subject.events.watchTransport.currentOwnership()).toEqual(subject.incumbent);
        expect(subject.state.appState.selectedGame?.campaignId).toBe('smite-campaign');
        expect(
          subject.tabs.updated.some(
            (update) => update.id === subject.incumbent.tabId && update.properties.url !== undefined,
          ),
        ).toBe(true);
        // Only its initial startup may navigate the incumbent; preparing the candidate does not.
        expect(
          subject.tabs.updated.filter(
            (update) => update.id === subject.incumbent.tabId && update.properties.url !== undefined,
          ),
        ).toHaveLength(1);
      } finally {
        subject.release.resolve();
      }
      const response = await switching;
      // Ownership cleanup crosses browser storage and script boundaries asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(response.success).toBe(result === 'started');
      expect(subject.tabs.pages).toHaveProperty('size', 1);
      expect(await listManagedWatches()).toHaveLength(1);
      if (result === 'started') {
        expect(subject.tabs.pages.has(subject.incumbent.tabId)).toBe(false);
        expect(subject.events.watchTransport.currentOwnership()).toMatchObject({
          tabId: candidateId,
          expectedChannel: 'r6_streamer',
        });
        expect(subject.state.appState.selectedGame?.campaignId).toBe('r6-campaign');
      } else {
        expect(subject.tabs.pages.has(candidateId)).toBe(false);
        expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe(
          'https://www.twitch.tv/smite_streamer',
        );
        expect(subject.events.watchTransport.currentOwnership()).toEqual(subject.incumbent);
        expect(subject.state.appState.activeStreamer?.name).toBe('smite_streamer');
      }
    });
  }

  test('a successful replacement neutralizes an obsolete sole tab without closing its window', async () => {
    const subject = await fixture('started');
    const incumbentPage = subject.tabs.pages.get(subject.incumbent.tabId);
    if (!incumbentPage) throw new Error('Expected incumbent page');
    incumbentPage.windowId = 7;
    const switching = subject.session.handleSetSelectedGame({ game: subject.games[1]! });
    const candidateId = await subject.entered.promise;
    subject.release.resolve();
    expect((await switching).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(subject.tabs.removed).toEqual([]);
    expect(subject.tabs.pages.get(subject.incumbent.tabId)?.url).toBe('about:blank');
    expect(subject.events.watchTransport.currentOwnership()).toMatchObject({
      tabId: candidateId,
      expectedChannel: 'r6_streamer',
    });
    expect(await listManagedWatches()).toHaveLength(1);
  });
});
