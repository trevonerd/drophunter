import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerTwitchContentHandlers } from '../src/background/service-worker-twitch-content-handlers.ts';
import { createServiceWorkerTwitchGateway } from '../src/background/service-worker-twitch-gateway.ts';
import {
  buildDropsDashboardResponse,
  createSession,
  installFetchMock,
  restoreFetch,
} from './api-operations-fixtures.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

let chrome: ReturnType<typeof setupChromeMocks>;
let originalFetch = globalThis.fetch;
beforeEach(() => {
  chrome = setupChromeMocks();
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  restoreFetch(originalFetch);
  chrome.teardown();
});

function blockedState() {
  const state = createServiceWorkerState();
  const game = createGame();
  state.appState.selectedGame = game;
  state.appState.queue = [game];
  state.appState.lastStopReason = 'sign-in-required';
  state.appState.manualQueueAuthorized = true;
  state.appState.farmingSessionOrigin = 'manual';
  state.appState.twitchSessionSyncState = { status: 'blocked', attempts: 1, nextRetryAt: null };
  state.twitchSessionCache = createSession();
  return state;
}

test('content session sync does not resume farming after Stop interrupts campaign refresh', async () => {
  const state = blockedState();
  const entered = createDeferred<void>();
  const refreshed = createDeferred<void>();
  let resumes = 0;
  const farming = createFarmingSession(state, createFarmingSessionAdapters());
  const handlers = createServiceWorkerTwitchContentHandlers(state, {
    awaitInitialization: async () => undefined,
    shouldRefreshCampaignsAfterSessionSync: () => true,
    requestAuthRecoveredSync: async () => {
      entered.resolve(undefined);
      await refreshed.promise;
    },
    resumeAfterAuthRecovery: async () => {
      resumes += 1;
    },
    recordChannelPointsBonusClaimed: async () => {},
  });
  const pending = handlers.handleSyncTwitchSession(
    { session: createSession({ oauthToken: 'refreshed-session-token-12345678' }) },
    {
      tab: { id: 1, url: 'https://www.twitch.tv/drops/inventory' },
    },
  );
  await entered.promise;
  await farming.handleStopFarming();
  refreshed.resolve(undefined);
  await pending;
  expect(resumes).toBe(0);
  expect(state.appState.isRunning).toBe(false);
  expect(state.appState.lastStopReason).toBe('user-stop');
});

test.each([
  false,
  true,
])('snapshot recovery does not resume farming after Stop (progressive=%s)', async (progressive) => {
  const state = blockedState();
  const entered = createDeferred<void>();
  const response = createDeferred<void>();
  let resumes = 0;
  originalFetch = installFetchMock([
    async () => {
      entered.resolve(undefined);
      await response.promise;
      return buildDropsDashboardResponse([]);
    },
    async () => ({
      data: { currentUser: { inventory: { dropCampaignsInProgress: [], gameEventDrops: [] } } },
    }),
  ]);
  const farming = createFarmingSession(state, createFarmingSessionAdapters());
  const gateway = createServiceWorkerTwitchGateway(state, {
    recoverTwitchSession: async () => {},
    resumeAfterAuthRecovery: async () => {
      resumes += 1;
    },
  });
  const pending = progressive ? gateway.fetchDropsSnapshotProgressively() : gateway.fetchDropsSnapshot();
  await entered.promise;
  await farming.handleStopFarming();
  response.resolve(undefined);
  expect(await pending).not.toBeNull();
  expect(resumes).toBe(0);
  expect(state.appState.isRunning).toBe(false);
  expect(state.appState.lastStopReason).toBe('user-stop');
});

test('auth resume cannot acquire a streamer after Stop interrupts workspace resolution', async () => {
  const state = blockedState();
  const entered = createDeferred<void>();
  const workspace = createDeferred<string>();
  let acquisitions = 0;
  const farming = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      resolveCategorySlug: async () => {
        entered.resolve(undefined);
        return workspace.promise;
      },
      fetchDirectoryStreamersFromApi: async () => {
        acquisitions += 1;
        return Object.assign([], { languageFilterApplied: false });
      },
    }),
  );
  const pending = farming.resumeAfterAuthRecovery();
  await entered.promise;
  await farming.handleStopFarming();
  workspace.resolve('test-game');
  await pending;
  expect(acquisitions).toBe(0);
  expect(state.appState.isRunning).toBe(false);
  expect(state.appState.lastStopReason).toBe('user-stop');
});
