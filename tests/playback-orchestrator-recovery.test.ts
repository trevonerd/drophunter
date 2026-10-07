import { describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createPlaybackOrchestrator } from '../src/background/playback-orchestrator.ts';
import { createPlaybackTransport } from '../src/background/playback-transport.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchStreamer } from '../src/types';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { required } from './support/required.ts';

function createState() {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.invalidStreamChecks = 3;
  return state;
}

function createTabsApi() {
  const updates: Array<{ tabId: number; properties: unknown }> = [];
  return {
    updates,
    async get(tabId: number) {
      return { id: tabId, windowId: 5 };
    },
    async update(tabId: number, properties: unknown) {
      updates.push({ tabId, properties });
      return { id: tabId, windowId: 5 };
    },
    async sendMessage() {
      return {};
    },
  };
}

const streamer: TwitchStreamer = {
  id: 'StreamerOne',
  name: 'StreamerOne',
  displayName: 'Streamer One',
  isLive: true,
  viewerCount: 12,
};

describe('playback orchestrator recovery', () => {
  test.each(['Stop', 'Play'] as const)(
    '%s supersedes a pending legacy managed open before publication or playback',
    async (action) => {
      const mocks = setupChromeMocks();
      const state = createState();
      const games = ['one', 'two'].map((id) => createGame({ id, campaignId: `${id}-campaign` }));
      state.appState.selectedGame = required(games[0]);
      state.appState.queue = games;
      state.appState.availableGames = games;
      const requested = Promise.withResolvers<void>();
      const release = Promise.withResolvers<number>();
      const messages: unknown[] = [];
      const orchestrator = createPlaybackOrchestrator(state, {
        transport: createPlaybackTransport({
          tabsApi: {
            ...createTabsApi(),
            sendMessage: async (_tabId, message) => {
              messages.push(message);
              return {};
            },
          },
          windowsApi: { update: async () => null },
          ensureContentScriptOnTab: async () => {},
          ensureManagedTab: async () => {
            requested.resolve();
            return release.promise;
          },
          waitForTabComplete: async () => {},
        }),
        shouldMuteManagedFarmingTab: () => true,
        streamerWatchUrl: (channel) => `https://www.twitch.tv/${channel}`,
      });
      const session = createFarmingSession(state, createFarmingSessionAdapters());
      const opening = orchestrator.openForegroundChannel(streamer);
      try {
        await requested.promise;
        if (action === 'Stop') await session.handleStopFarming();
        else
          expect(await session.handleStartQueuedCampaign(gameKey(required(games[1])))).toEqual({
            success: true,
          });
        release.resolve(77);
        expect(await opening).toBeNull();
        expect(state.appState.tabId).toBeNull();
        expect(state.appState.activeStreamer).toBeNull();
        expect(messages).toEqual([]);
        if (action === 'Play') expect(state.appState.selectedGame?.campaignId).toBe('two-campaign');
      } finally {
        release.resolve(77);
        await opening;
        session.stopMonitoring();
        mocks.teardown();
      }
    },
  );

  test('Stop during a pending tab check cannot send a new playback preparation', async () => {
    const mocks = setupChromeMocks();
    const state = createState();
    state.appState.tabId = 77;
    state.streamValidationGraceUntil = Date.now() + 60_000;
    const tab = Promise.withResolvers<{ id: number; windowId: number }>();
    const requested = Promise.withResolvers<void>();
    const messages: unknown[] = [];
    const orchestrator = createPlaybackOrchestrator(state, {
      transport: createPlaybackTransport({
        tabsApi: {
          ...createTabsApi(),
          get: async () => {
            requested.resolve();
            return tab.promise;
          },
          sendMessage: async (_tabId, message) => {
            messages.push(message);
            return {};
          },
        },
        windowsApi: { update: async () => null },
        ensureContentScriptOnTab: async () => {},
        ensureManagedTab: async () => 77,
        waitForTabComplete: async () => {},
      }),
      shouldMuteManagedFarmingTab: () => true,
      streamerWatchUrl: (channel) => `https://www.twitch.tv/${channel}`,
    });
    const session = createFarmingSession(state, createFarmingSessionAdapters());
    const policy = orchestrator.enforcePlaybackPolicyOnStreamTab();
    try {
      await requested.promise;
      await session.handleStopFarming();
      tab.resolve({ id: 77, windowId: 5 });
      await policy;
      expect(state.appState.lastStopReason).toBe('user-stop');
      expect(messages).toEqual([]);
    } finally {
      tab.resolve({ id: 77, windowId: 5 });
      await policy;
      mocks.teardown();
    }
  });

  test.each(['self-heal', 'visible focus', 'visible document wait'] as const)(
    'Stop prevents a late preparation after pending %s',
    async (operation) => {
      const mocks = setupChromeMocks();
      const state = createState();
      const requested = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const settled = Promise.withResolvers<void>();
      const messages: unknown[] = [];
      const hold = async () => {
        requested.resolve();
        await release.promise;
      };
      const transport = createPlaybackTransport({
        tabsApi: {
          ...createTabsApi(),
          get: async (tabId) => {
            if (operation === 'visible focus') await hold();
            return { id: tabId, windowId: 5 };
          },
          sendMessage: async (_tabId, message) => {
            messages.push(message);
            return {};
          },
        },
        windowsApi: { update: async () => null },
        ensureContentScriptOnTab: async () => {
          if (operation === 'self-heal') await hold();
        },
        ensureManagedTab: async () => 77,
        waitForTabComplete: async () => {
          if (operation === 'visible document wait') await hold();
        },
      });
      const orchestrator = createPlaybackOrchestrator(state, {
        transport: {
          ...transport,
          prepareVisible: async (...args) => {
            try {
              return await transport.prepareVisible(...args);
            } finally {
              settled.resolve();
            }
          },
        },
        shouldMuteManagedFarmingTab: () => true,
        streamerWatchUrl: (channel) => `https://www.twitch.tv/${channel}`,
      });
      const session = createFarmingSession(state, createFarmingSessionAdapters());
      const preparation =
        operation === 'self-heal'
          ? orchestrator.attemptPlaybackSelfHeal(77).finally(() => settled.resolve())
          : orchestrator.openForegroundChannel(streamer, { focus: operation === 'visible focus' });
      try {
        await requested.promise;
        await session.handleStopFarming();
        release.resolve();
        await preparation;
        await settled.promise;
        expect(state.appState.lastStopReason).toBe('user-stop');
        expect(state.appState.tabId).toBeNull();
        expect(state.appState.activeStreamer).toBeNull();
        expect(messages).toEqual([]);
      } finally {
        release.resolve();
        await preparation;
        await settled.promise;
        mocks.teardown();
      }
    },
  );
});
