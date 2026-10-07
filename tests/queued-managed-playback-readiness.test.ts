import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { extractStreamContext } from '../src/content/stream-context.ts';
import { prepareStreamPlayback } from '../src/content/stream-playback.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

// Compose the public commands, native ownership, real background playback
// preparation and content playback/parser. Only Chrome and Twitch data are fake.
for (const command of ['Start Queue', 'queued Play'] as const) {
  test.each(['player-not-mounted', 'mature-content-gate'] as const)(
    `${command} keeps the first streamer while Twitch finishes %s`,
    async (initialPage) => {
      const mocks = setupChromeMocks();
      const tabs = installManagedWatchPages(mocks);
      const globals = new Map<string, PropertyDescriptor | undefined>();
      const installGlobal = (name: string, value: unknown) => {
        globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, value });
      };
      let mountTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const state = createServiceWorkerState();
        const game = createGame({
          id: 'albion',
          name: 'Albion',
          categorySlug: 'albion',
          campaignId: 'albion-campaign',
          dropCount: 1,
          endsAt: '2030-08-05T12:00:00.000Z',
          rewardSummary: { completion: 'farmable', remainderReasons: [] },
        });
        const drop = createDrop({
          gameId: game.id,
          gameName: game.name,
          campaignId: game.campaignId,
          requiredMinutes: 60,
        });
        Object.assign(state.appState, {
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
          updatedAt: Date.now(),
        };
        const session = { oauthToken: 'a'.repeat(30), userId: '123', deviceId: 'device', uuid: 'uuid' };
        state.twitchSessionCache = session;
        const directory = async () =>
          Object.assign(
            [
              createStreamer({ name: 'first_streamer', viewerCount: 100 }),
              createStreamer({ name: 'second_streamer', viewerCount: 50 }),
            ],
            { languageFilterApplied: true },
          );
        let pageUrl = '';
        let mounted = false;
        let gateVisible = initialPage === 'mature-content-gate';
        let sawInitialNotReady = false;
        let clock = 0;
        const video = {
          paused: false,
          ended: false,
          readyState: 4,
          isConnected: true,
          muted: true,
          get currentTime() {
            clock += 0.25;
            return clock;
          },
        };
        const gate = {
          dispatchEvent: () => {
            sawInitialNotReady = true;
            gateVisible = false;
            mounted = true;
          },
        };
        const category = { textContent: 'Albion', getAttribute: () => '/directory/category/albion' };
        installGlobal('window', {
          location: {
            get href() {
              return pageUrl;
            },
          },
        });
        installGlobal('navigator', { userActivation: { hasBeenActive: false } });
        installGlobal('MouseEvent', class {});
        installGlobal('document', {
          title: 'Drops enabled - Twitch',
          documentElement: { dataset: {} },
          querySelector: (selector: string) => {
            if (selector === 'video') {
              if (!mounted) {
                sawInitialNotReady = true;
                mountTimer ??= setTimeout(() => {
                  mounted = true;
                }, 0);
              }
              return mounted ? video : null;
            }
            if (selector.includes('content-classification-gate')) return gateVisible ? gate : null;
            if (selector.includes('stream-title')) return { textContent: 'Drops enabled' };
            return null;
          },
          querySelectorAll: (selector: string) => {
            if (selector === 'video') return mounted ? [video] : [];
            if (selector === 'a[data-a-target="stream-game-link"]') return [category];
            return [];
          },
        });
        const visit = (tabId: number) => {
          pageUrl = tabs.pages.get(tabId)?.url ?? '';
        };
        const observations: boolean[] = [];
        mocks.chrome.tabs.sendMessage = async (tabId) => {
          visit(tabId);
          const result = await prepareStreamPlayback();
          observations.push(result.isPlaybackReady);
          return result;
        };
        const fetchStreamContext = async (tabId: number) => {
          visit(tabId);
          return extractStreamContext();
        };
        const browserEvents = createServiceWorkerBrowserEvents(state, {
          ensureContentScriptOnTab: async () => {},
          fetchStreamContext,
          heartbeat: async () => ({ accepted: false }),
          notify: async () => {},
          notifyQueueComplete: async () => {},
          clearQueueCompleteNotification: async () => {},
        });
        const farming = createFarmingSession(
          state,
          createFarmingSessionAdapters({
            watchTransport: browserEvents.watchTransport,
            ensureTwitchSession: async () => session,
            fetchDropsSnapshotFromApi: async () => snapshot,
            fetchInventorySnapshotFromApi: async () => snapshot,
            fetchDirectoryStreamersFromApi: directory,
            fetchStreamContext,
          }),
        );
        const result =
          command === 'Start Queue'
            ? await farming.handleStartFarming({ game })
            : await farming.handleStartQueuedCampaign(gameKey(game));
        expect(result).toEqual({ success: true });
        expect(tabs.created).toEqual([]);
        expect(state.appState).toMatchObject({
          isRunning: true,
          manualQueueAuthorized: true,
          activeStreamer: null,
          tabId: null,
          watchHealth: null,
        });
        await farming.checkDropProgress();
        const visitedChannels = [
          ...tabs.navigated.map(({ url }) => url),
          ...tabs.updated.flatMap(({ properties }) => (properties.url ? [properties.url] : [])),
        ];
        expect(sawInitialNotReady).toBe(true);
        expect(new Set(visitedChannels).size).toBe(1);
        expect(observations).toContain(true);
        expect(browserEvents.watchTransport.currentOwnership()?.kind).toBe('managed-tab');
        expect(state.appState.isRunning).toBe(true);
        expect(state.appState.activeStreamer).not.toBeNull();
      } finally {
        clearTimeout(mountTimer);
        for (const [name, descriptor] of globals) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else Reflect.deleteProperty(globalThis, name);
        }
        mocks.teardown();
      }
    },
  );
}
