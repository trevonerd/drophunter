import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerContentHandlers } from '../src/background/service-worker-content-handlers.ts';
import type { DropsSnapshot } from '../src/types/index.ts';
import { createDrop, createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());

test.each(['manual', 'favorite-change'] as const)(
  'explicit Drops opening focuses its window while %s synchronization stays in flight',
  async (trigger) => {
    const state = createServiceWorkerState();
    const game = createGame({ campaignId: 'campaign', dropCount: 1 });
    state.appState.availableGames = [game];
    const snapshot = Promise.withResolvers<DropsSnapshot>();
    const entered = Promise.withResolvers<void>();
    let refreshes = 0;
    const fetchSnapshot = async () => {
      refreshes++;
      entered.resolve();
      return snapshot.promise;
    };
    const focused: number[] = [];
    mocks.tabs.setTabsQueryResult([
      { id: 7, windowId: 2, url: 'https://www.twitch.tv/drops/campaigns', status: 'complete' },
    ]);
    mocks.tabs.setTabsGetResult({
      id: 7,
      windowId: 2,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    mocks.chrome.windows.update = async (windowId) => {
      focused.push(windowId);
      return null;
    };
    const handlers = createServiceWorkerContentHandlers(state, {
      automation: {
        request: async () => ({ kind: 'unchanged', reason: 'disabled' }),
        suppressCampaignUntilRefresh: async () => 'suppressed',
      },
      farmingSession: createFarmingSession(state, createFarmingSessionAdapters()),
      stateLifecycle: {
        awaitInitialization: async () => {},
        ensureStateHydratedForCache: async () => {},
        getInitPromise: () => null,
        trackActivity: async () => {},
      },
      twitchGateway: {
        ensureContentScriptOnTab: async () => {},
        fetchDropsSnapshot: fetchSnapshot,
        fetchDropsSnapshotProgressively: fetchSnapshot,
        getLastTwitchApiFailure: () => null,
        persistSessionFromDropsPage: async () => null,
        shouldRefreshCampaignsAfterSessionSync: () => false,
      },
      notify: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
    const first =
      trigger === 'manual' ? handlers.openDropsAndSync() : handlers.requestActivationSync(trigger);
    await entered.promise;
    focused.length = 0;
    const manual = handlers.openDropsAndSync();
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(focused).toContain(2);
    } finally {
      snapshot.resolve({
        games: [game],
        drops: [createDrop({ campaignId: game.campaignId })],
        updatedAt: Date.now(),
        inventoryVerified: true,
      });
      await Promise.all([first, manual]);
    }
    expect(refreshes).toBe(1);
  },
);
