import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clearRotationMetadata, createServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  clearPendingTimingStateSaveForTests,
  loadState as loadPersistedState,
  setTimingSaveDebounceMsForTests,
} from '../src/background/state-persistence.ts';
import type { RuntimeRequest } from '../src/shared/messages.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { AppState, TwitchGame } from '../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome';

const chromeMocks = setupChromeMocks();
setTimingSaveDebounceMsForTests(0);

function createEventMock<T>() {
  const handlers: Array<(value: T) => void> = [];
  return {
    _handlers: handlers,
    addListener(handler: (value: T) => void) {
      handlers.push(handler);
    },
    removeListener(handler: (value: T) => void) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    },
    trigger(value: T) {
      handlers.forEach((handler) => handler(value));
    },
  };
}

function installServiceWorkerSupportMocks(mocks: ChromeMocks) {
  const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;

  const syncStore = new Map<string, unknown>();
  const syncStorage = {
    async get(keys: string | string[] | Record<string, unknown> | null) {
      if (keys === null) {
        return Object.fromEntries(syncStore);
      }

      const result: Record<string, unknown> = {};
      if (typeof keys === 'string') {
        if (syncStore.has(keys)) {
          result[keys] = syncStore.get(keys);
        }
        return result;
      }

      if (Array.isArray(keys)) {
        for (const key of keys) {
          if (syncStore.has(key)) {
            result[key] = syncStore.get(key);
          }
        }
        return result;
      }

      for (const [key, fallback] of Object.entries(keys)) {
        result[key] = syncStore.has(key) ? syncStore.get(key) : fallback;
      }
      return result;
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) {
        syncStore.set(key, value);
      }
    },
    async clear() {
      syncStore.clear();
    },
  };

  chromeAny.runtime.onStartup = createEventMock<void>();
  chromeAny.runtime.onInstalled = createEventMock<{ reason: 'install' | 'update' | 'chrome_update' }>();
  chromeAny.runtime.getURL = (path: string) => `chrome-extension://test-extension/${path}`;
  chromeAny.runtime.id = 'test-extension';

  chromeAny.alarms.clear = async () => undefined;

  chromeAny.tabs.onRemoved = createEventMock<number>();
  chromeAny.tabs.onUpdated = createEventMock<{ status?: string; url?: string }>();
  chromeAny.tabs.create = async () => ({ id: 999, windowId: 1 });
  chromeAny.tabs.update = async (tabId: number) => ({ id: tabId, windowId: 1 });
  chromeAny.tabs.remove = async () => undefined;
  chromeAny.tabs.sendMessage = async () => ({ success: false });

  chromeAny.windows = {
    get: async () => null,
    getLastFocused: async () => ({ id: 1 }),
    update: async () => null,
    create: async () => ({ id: 1 }),
    onRemoved: createEventMock<number>(),
  };

  chromeAny.notifications = {
    create: async () => 'notification-id',
  };

  chromeAny.permissions = {
    contains: mocks.permissions.contains,
    request: mocks.permissions.request,
  };

  chromeAny.scripting = {
    executeScript: async () => [],
  };

  chromeAny.storage.session.remove = async () => undefined;
  chromeAny.storage.sync = syncStorage;
  chromeAny.storage.local.remove = async (keys: string | string[]) => {
    if (Array.isArray(keys)) {
      keys.forEach((key) => mocks.storage.local._store.delete(key));
      return;
    }
    mocks.storage.local._store.delete(keys);
  };

  mocks.tabs.setTabsQueryResult([]);
}

installServiceWorkerSupportMocks(chromeMocks);

const serviceWorkerModule = await import('../src/background/service-worker.ts');
serviceWorkerModule.startServiceWorker();

const demoGame: TwitchGame = {
  id: 'game-1',
  name: 'Demo Game',
  imageUrl: 'https://example.com/demo.png',
  campaignId: 'campaign-1',
  categorySlug: 'demo-game',
};

const nextGame: TwitchGame = {
  id: 'queue-next-game',
  name: 'Next Game',
  imageUrl: 'https://example.com/next.png',
  campaignId: 'queue-next-campaign',
  categorySlug: 'next-game',
};

const thirdGame: TwitchGame = {
  id: 'queue-third-game',
  name: 'Third Game',
  imageUrl: 'https://example.com/third.png',
  campaignId: 'queue-third-campaign',
  categorySlug: 'third-game',
};

type MockFetchResponse = {
  json: unknown;
  ok?: boolean;
  status?: number;
};

type SnapshotDropSpec = {
  game: TwitchGame;
  dropId: string;
  currentMinutes?: number;
  requiredMinutes?: number;
  endsAt?: string;
};

type SnapshotScenario = {
  drops: SnapshotDropSpec[];
};

const snapshotQueue: SnapshotScenario[] = [];
const directoryQueue: Array<string | null> = [];
let activeSnapshotScenario: SnapshotScenario | null = null;

function futureIso(hours = 24) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createCampaignDrop(spec: SnapshotDropSpec) {
  const endsAt = spec.endsAt ?? futureIso();
  return {
    id: spec.dropId,
    name: `${spec.game.name} Reward`,
    requiredMinutesWatched: spec.requiredMinutes ?? 60,
    endAt: endsAt,
    benefitEdges: [],
  };
}

function createCampaign(spec: SnapshotDropSpec) {
  const endsAt = spec.endsAt ?? futureIso();
  return {
    id: spec.game.campaignId,
    status: 'ACTIVE',
    endAt: endsAt,
    game: {
      displayName: spec.game.name,
      name: spec.game.name,
      slug: spec.game.categorySlug,
      boxArtURL: spec.game.imageUrl,
    },
    timeBasedDrops: [createCampaignDrop(spec)],
    eventBasedDrops: [],
  };
}

function createInventoryCampaign(spec: SnapshotDropSpec) {
  return {
    id: spec.game.campaignId,
    game: {
      displayName: spec.game.name,
      name: spec.game.name,
    },
    timeBasedDrops: [
      {
        id: spec.dropId,
        requiredMinutesWatched: spec.requiredMinutes ?? 60,
        endAt: spec.endsAt ?? futureIso(),
        self: {
          currentMinutesWatched: spec.currentMinutes ?? 0,
          isClaimed: false,
          isClaimable: false,
        },
      },
    ],
  };
}

function enqueueDropsSnapshot(dropSpecs: SnapshotDropSpec[]) {
  snapshotQueue.push({ drops: dropSpecs });
}

function enqueueDirectoryResult(streamerName: string | null) {
  directoryQueue.push(streamerName);
}

function installFetchMock() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    const jsonResponse = (json: unknown, options: Omit<MockFetchResponse, 'json'> = {}) =>
      ({
        ok: options.ok ?? true,
        status: options.status ?? 200,
        async json() {
          return json;
        },
      }) as Response;

    if (Array.isArray(body)) {
      const scenario = activeSnapshotScenario;
      if (!scenario) {
        throw new Error('Unexpected campaign details fetch in service-worker test');
      }
      const campaigns = scenario.drops.map((spec) => createCampaign(spec));
      activeSnapshotScenario = null;
      return jsonResponse(
        campaigns.map((campaign) => ({
          data: {
            user: {
              dropCampaign: campaign,
            },
          },
        })),
      );
    }

    if (url.includes('/integrity')) {
      return jsonResponse({ token: 'integrity-token' });
    }

    switch (body?.operationName) {
      case 'ViewerDropsDashboard': {
        const scenario = snapshotQueue.shift();
        if (!scenario) {
          throw new Error('Unexpected drops dashboard fetch in service-worker test');
        }
        activeSnapshotScenario = scenario;
        return jsonResponse({
          data: {
            currentUser: {
              dropCampaigns: scenario.drops.map((spec) => createCampaign(spec)),
            },
          },
        });
      }

      case 'Inventory': {
        const scenario = activeSnapshotScenario ?? snapshotQueue.shift();
        if (!scenario) {
          throw new Error('Unexpected inventory fetch in service-worker test');
        }
        if (activeSnapshotScenario && scenario.drops.length === 0) {
          activeSnapshotScenario = null;
        }
        return jsonResponse({
          data: {
            currentUser: {
              inventory: {
                dropCampaignsInProgress: scenario.drops.map((spec) => createInventoryCampaign(spec)),
                gameEventDrops: [],
              },
            },
          },
        });
      }

      case 'DirectoryPage_Game': {
        const streamerName = directoryQueue.shift();
        if (streamerName === undefined) {
          throw new Error('Unexpected directory fetch in service-worker test');
        }
        return jsonResponse({
          data: {
            game: {
              streams: {
                edges: streamerName
                  ? [
                      {
                        node: {
                          broadcaster: {
                            login: streamerName,
                            displayName: streamerName,
                          },
                          viewersCount: 123,
                        },
                      },
                    ]
                  : [],
              },
            },
          },
        });
      }

      case 'DropsPage_ClaimDropRewards': {
        return jsonResponse({
          data: {
            claimDropRewards: {
              status: 'SUCCESS',
            },
          },
        });
      }

      case 'CoreActionsCurrentUser': {
        return jsonResponse({
          data: {
            currentUser: {
              id: '123456',
            },
          },
        });
      }

      default:
        throw new Error(
          `Unexpected fetch operation in service-worker test: ${body?.operationName ?? 'unknown'}`,
        );
    }
  }) as typeof fetch;
}

function installActiveTabMocks() {
  const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;

  chromeAny.tabs.create = async ({ url }: { url?: string }) => ({
    id: 999,
    windowId: 1,
    url: url ?? 'https://www.twitch.tv/test-streamer',
    status: 'complete',
  });
  chromeAny.tabs.update = async (tabId: number, updateProperties?: { url?: string; active?: boolean }) => ({
    id: tabId,
    windowId: 1,
    url: updateProperties?.url ?? 'https://www.twitch.tv/test-streamer',
    active: Boolean(updateProperties?.active),
    status: 'complete',
  });
  chromeAny.tabs.get = async (tabId: number) => ({
    id: tabId,
    windowId: 1,
    url: 'https://www.twitch.tv/test-streamer',
    status: 'complete',
  });
  chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
    if (message?.type === 'PREPARE_STREAM_PLAYBACK') {
      return { success: true, isPlaybackReady: true, userInteractionRequired: false };
    }
    if (message?.type === 'GET_STREAM_CONTEXT') {
      return { success: false };
    }
    return { success: false };
  };
}

function getAppStateFromStorage(): AppState {
  return chromeMocks.storage.local._store.get('appState') as AppState;
}

function sleepTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForAppState(check: (state: AppState) => boolean, message: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = getAppStateFromStorage();
    if (state && check(state)) {
      return state;
    }
    await sleepTick();
  }
  throw new Error(message);
}

async function dispatchMessage(
  message: RuntimeRequest,
  sender: Record<string, unknown> = {},
): Promise<unknown> {
  const handler = chromeMocks.runtime.onMessage._handlers[0];
  if (!handler) {
    throw new Error('service worker onMessage handler not registered');
  }

  return new Promise((resolve) => {
    handler(message, sender, (response?: unknown) => resolve(response));
  });
}

async function dispatchMessageFromMocks(
  mocks: ChromeMocks,
  message: RuntimeRequest,
  sender: Record<string, unknown> = {},
): Promise<unknown> {
  const handler = mocks.runtime.onMessage._handlers[0];
  if (!handler) {
    throw new Error('service worker onMessage handler not registered');
  }

  return new Promise((resolve) => {
    handler(message, sender, (response?: unknown) => resolve(response));
  });
}

async function importServiceWorkerWithBlockedInitialLoad(testId: string, appState: AppState) {
  const isolatedMocks = setupChromeMocks();
  installServiceWorkerSupportMocks(isolatedMocks);
  await isolatedMocks.storage.local.set({ appState });

  const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
  const originalGet = chromeAny.storage.local.get.bind(chromeAny.storage.local);
  const originalSet = chromeAny.storage.local.set.bind(chromeAny.storage.local);
  const setCalls: Array<Record<string, unknown>> = [];
  let initialLoadBlocked = false;
  let releaseInitialLoad: () => void = () => {};
  const initialLoadStarted = new Promise<void>((resolveStarted) => {
    const releasePromise = new Promise<void>((resolveRelease) => {
      releaseInitialLoad = resolveRelease;
    });
    chromeAny.storage.local.get = async (keys: unknown) => {
      if (!initialLoadBlocked && Array.isArray(keys) && keys.includes('appState')) {
        initialLoadBlocked = true;
        resolveStarted();
        await releasePromise;
      }
      return originalGet(keys);
    };
  });

  chromeAny.storage.local.set = async (items: Record<string, unknown>) => {
    setCalls.push(items);
    return originalSet(items);
  };

  const isolatedServiceWorkerModule = await import(
    `../src/background/service-worker.ts?init-race-${testId}-${Date.now()}`
  );
  isolatedServiceWorkerModule.startServiceWorker();
  await initialLoadStarted;

  return {
    mocks: isolatedMocks,
    releaseInitialLoad,
    setCalls,
  };
}

async function resetWorkerState() {
  await dispatchMessage({ type: 'STOP_FARMING' });
  await dispatchMessage({ type: 'CLEAR_QUEUE' });
  await dispatchMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
  await dispatchMessage({ type: 'SET_AUTO_RESUME_ON_STARTUP', payload: { enabled: false } });
}

async function syncTestSession() {
  await dispatchMessage(
    {
      type: 'SYNC_TWITCH_SESSION',
      payload: {
        session: {
          oauthToken: 'oauth-token-with-valid-length-1234567890',
          userId: '123456',
          deviceId: 'device-12345678',
          uuid: 'uuid-1',
        },
      },
    },
    { tab: { id: 42, url: 'https://www.twitch.tv/drops/campaigns' } },
  );
}

async function addGameToQueue(game: TwitchGame) {
  await dispatchMessage({
    type: 'ADD_TO_QUEUE',
    payload: { game },
  });
}

async function triggerMonitorAlarm() {
  chromeMocks.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: Date.now() });
  await sleepTick();
}

describe('service worker message handlers', () => {
  beforeEach(async () => {
    snapshotQueue.length = 0;
    directoryQueue.length = 0;
    activeSnapshotScenario = null;
    chromeMocks.permissions.setContainsResult(false);
    chromeMocks.permissions.setRequestResult(false);
    chromeMocks.permissions._requests.length = 0;
    installFetchMock();
    installActiveTabMocks();
    await resetWorkerState();
  });

  afterEach(() => {
    chromeMocks.storage.session._store.clear();
  });

  afterAll(async () => {
    await sleepTick();
    clearPendingTimingStateSaveForTests();
    setTimingSaveDebounceMsForTests(null);
    chromeMocks.teardown();
  });

  test('registers runtime onMessage listener at module load', () => {
    expect(chromeMocks.runtime.onMessage._handlers.length).toBeGreaterThan(0);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH waits for initialization before touching refresh state', async () => {
    const isolated = await importServiceWorkerWithBlockedInitialLoad('open-drops', createInitialState());
    try {
      const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
      let createCalls = 0;
      chromeAny.tabs.create = async () => {
        createCalls += 1;
        return null;
      };

      const responsePromise = dispatchMessageFromMocks(isolated.mocks, {
        type: 'OPEN_DROPS_PAGE_AND_REFRESH',
        payload: { waitForRefresh: false },
      });

      await sleepTick();
      await sleepTick();

      expect(createCalls).toBe(0);
      expect(isolated.setCalls).toHaveLength(0);

      isolated.releaseInitialLoad();
      const response = (await responsePromise) as { success?: boolean; error?: string };

      expect(createCalls).toBe(1);
      expect(response).toEqual({
        success: false,
        opened: false,
        refreshed: false,
        gamesCount: 0,
        error: 'Unable to open the Twitch Drops page.',
      });
    } finally {
      isolated.mocks.teardown();
    }
  });

  test('ENSURE_GAMES_CACHE waits for initialization before touching cache state', async () => {
    const persisted = {
      ...createInitialState(),
      availableGames: [demoGame],
    };
    const isolated = await importServiceWorkerWithBlockedInitialLoad('ensure-cache', persisted);
    try {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('unexpected fetch before initialization');
      }) as typeof fetch;

      const responsePromise = dispatchMessageFromMocks(isolated.mocks, { type: 'ENSURE_GAMES_CACHE' });

      await sleepTick();
      await sleepTick();

      expect(fetchCalls).toBe(0);
      expect(isolated.setCalls).toHaveLength(0);

      isolated.releaseInitialLoad();
      const response = (await responsePromise) as { success?: boolean; gamesCount?: number };

      expect(response.success).toBe(true);
      expect(response.gamesCount).toBe(1);
      expect(fetchCalls).toBe(0);
    } finally {
      isolated.mocks.teardown();
    }
  });

  test('START_FARMING returns an error when no game is provided', async () => {
    const response = await dispatchMessage({ type: 'START_FARMING' });

    expect(response).toEqual({ success: false, error: 'No game selected.' });
    expect(getAppStateFromStorage().isRunning).toBe(false);
  });

  test('CHANNEL_POINTS_BONUS_CLAIMED increments and persists channel point stats', async () => {
    const baseline = getAppStateFromStorage().totalChannelPointsClaimed;
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    const notifications: unknown[] = [];
    chromeAny.notifications.create = async (options: unknown) => {
      notifications.push(options);
      return 'notification-id';
    };
    chromeMocks.permissions.setContainsResult(true);
    await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    const response = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'trevonerd' } },
      { tab: { id: 123, url: 'https://www.twitch.tv/trevonerd' } },
    );

    expect(response).toEqual({ success: true });
    expect(getAppStateFromStorage().totalChannelPointsClaimed).toBe(baseline + 1);
    expect(notifications).toContainEqual(
      expect.objectContaining({
        title: 'Channel points claimed',
        message: 'Claimed from trevonerd.',
      }),
    );
  });

  test('START_FARMING exits cleanly when no farmable drops are available', async () => {
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    const response = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(response).toEqual({ success: false, error: 'No farmable drops for this game.' });

    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.selectedGame).toBeNull();
  });

  test('START_FARMING rejects a farming-complete campaign without mutating the queue', async () => {
    const farmingCompleteGame: TwitchGame = {
      ...demoGame,
      id: 'farming-complete-game',
      name: 'Farming Complete Game',
      campaignId: 'farming-complete-campaign',
      dropCount: 1,
      rewardSummary: {
        completion: 'farming-complete',
        remainderReasons: ['unverifiable-twitch'],
      },
    };
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [farmingCompleteGame] });

    const response = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: farmingCompleteGame },
    });

    expect(response).toEqual({
      success: false,
      error: 'Farming finished · Twitch reward acquisition could not be verified',
    });
    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(false);
    expect(state.queue).toEqual([]);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH opens Twitch, extracts session, and refreshes campaigns', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    let createCalls = 0;
    let executeScriptCalls = 0;
    chromeMocks.tabs.setTabsQueryResult([]);
    chromeAny.tabs.create = async ({ url }: { url?: string }) => {
      createCalls += 1;
      return { id: 321, windowId: 1, url, status: 'complete' };
    };
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.scripting.executeScript = async () => {
      executeScriptCalls += 1;
      return [];
    };
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-open-page', currentMinutes: 0 }]);

    const beforeRefresh = Date.now();
    const response = (await dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' })) as {
      success?: boolean;
      gamesCount?: number;
      opened?: boolean;
      appState?: AppState;
    };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(true);
    expect(response.gamesCount).toBe(1);
    expect(response.appState?.dropsPageRefreshInProgress).toBe(false);
    expect(response.appState?.lastSuccessfulRefreshAt).toBeGreaterThanOrEqual(beforeRefresh);
    expect(createCalls).toBe(1);
    expect(executeScriptCalls).toBe(1);
    const state = getAppStateFromStorage();
    expect(state.availableGames).toHaveLength(1);
    expect(state.availableGames[0].campaignId).toBe(demoGame.campaignId);
    expect(state.lastSuccessfulRefreshAt).toBe(response.appState?.lastSuccessfulRefreshAt);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH can refresh through an inactive Twitch tab', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    const createdActiveValues: boolean[] = [];
    chromeMocks.tabs.setTabsQueryResult([]);
    chromeAny.tabs.create = async ({ url, active }: { url?: string; active?: boolean }) => {
      createdActiveValues.push(Boolean(active));
      return { id: 432, windowId: 1, url, active: Boolean(active), status: 'complete' };
    };
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-inactive-open-page', currentMinutes: 0 }]);

    const response = (await dispatchMessage({
      type: 'OPEN_DROPS_PAGE_AND_REFRESH',
      payload: { waitForRefresh: true, active: false },
    })) as { success?: boolean; gamesCount?: number; opened?: boolean };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(true);
    expect(response.gamesCount).toBe(1);
    expect(createdActiveValues).toEqual([false]);
    expect(getAppStateFromStorage().dropsPageRefreshInProgress).toBe(false);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH foreground async launch later populates campaign storage', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    const asyncGame: TwitchGame = {
      id: 'async-game',
      name: 'Async Game',
      imageUrl: 'https://example.com/async.png',
      campaignId: 'async-campaign',
      categorySlug: 'async-game',
    };
    const createdActiveValues: boolean[] = [];
    chromeMocks.tabs.setTabsQueryResult([]);
    chromeAny.tabs.create = async ({ url, active }: { url?: string; active?: boolean }) => {
      createdActiveValues.push(Boolean(active));
      return { id: 543, windowId: 1, url, active: Boolean(active), status: 'complete' };
    };
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: asyncGame, dropId: 'drop-async-launch', currentMinutes: 0 }]);

    const response = (await dispatchMessage({
      type: 'OPEN_DROPS_PAGE_AND_REFRESH',
      payload: { waitForRefresh: false, active: true },
    })) as { success?: boolean; opened?: boolean; refreshed?: boolean };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(true);
    expect(response.refreshed).toBe(false);
    expect(createdActiveValues).toEqual([true]);
    expect(getAppStateFromStorage().dropsPageRefreshInProgress).toBe(true);

    const refreshedState = await waitForAppState(
      (state) => state.availableGames.some((game) => game.campaignId === asyncGame.campaignId),
      'async Drops page refresh did not populate campaigns',
    );
    expect(refreshedState.dropsPageRefreshInProgress).toBe(false);
    expect(refreshedState.lastDropsPageRefreshError).toBeNull();
    expect(typeof refreshedState.lastDropsPageRefreshCompletedAt).toBe('number');
    expect(refreshedState.lastDropsPageRefreshCampaignCount).toBe(1);
    const completedAt = refreshedState.lastDropsPageRefreshCompletedAt as number;
    const seenResponse = (await dispatchMessage({
      type: 'MARK_DROPS_REFRESH_NOTICE_SEEN',
      payload: { seenAt: completedAt },
    })) as { success?: boolean; seenAt?: number | null };

    expect(seenResponse.success).toBe(true);
    expect(seenResponse.seenAt).toBe(completedAt);
    expect(getAppStateFromStorage().lastDropsPageRefreshNoticeSeenAt).toBe(completedAt);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH clears stale campaign state after a successful empty refresh', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-before-empty-refresh', currentMinutes: 20 }]);
    await syncTestSession();
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-before-empty-refresh', currentMinutes: 20 }]);
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: demoGame } });
    await addGameToQueue(demoGame);

    const before = getAppStateFromStorage();
    expect(before.availableGames).toHaveLength(1);
    expect(before.selectedGame?.campaignId).toBe(demoGame.campaignId);
    expect(before.pendingDrops.length).toBeGreaterThan(0);
    expect(before.queue).toHaveLength(1);

    snapshotQueue.length = 0;
    activeSnapshotScenario = null;
    chromeMocks.tabs.setTabsQueryResult([]);
    chromeAny.tabs.create = async ({ url, active }: { url?: string; active?: boolean }) => ({
      id: 765,
      windowId: 1,
      url,
      active: Boolean(active),
      status: 'complete',
    });
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([]);

    const realDateNow = Date.now;
    let now = realDateNow();
    Date.now = () => {
      now += 61_000;
      return now;
    };
    let response: { success?: boolean; gamesCount?: number; error?: string; appState?: AppState };
    try {
      response = (await dispatchMessage({
        type: 'OPEN_DROPS_PAGE_AND_REFRESH',
        payload: { waitForRefresh: true, active: false },
      })) as { success?: boolean; gamesCount?: number; error?: string; appState?: AppState };
    } finally {
      Date.now = realDateNow;
    }

    expect(response.success).toBe(false);
    expect(response.gamesCount).toBe(0);
    expect(response.error).toBe('No active Twitch Drops campaigns were detected.');
    expect(response.appState?.availableGames).toEqual([]);
    expect(response.appState?.selectedGame).toBeNull();
    expect(response.appState?.pendingDrops).toEqual([]);
    expect(response.appState?.completedDrops).toEqual([]);
    expect(response.appState?.allDrops).toEqual([]);
    expect(response.appState?.queue).toEqual([]);
    expect(response.appState?.dropsPageRefreshInProgress).toBe(false);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH reuses an existing Twitch Drops tab', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    let createCalls = 0;
    let updateCalls = 0;
    chromeMocks.tabs.setTabsQueryResult([
      { id: 654, url: 'https://www.twitch.tv/drops/campaigns', status: 'complete', windowId: 1 },
    ]);
    chromeAny.tabs.create = async () => {
      createCalls += 1;
      return { id: 999, windowId: 1, status: 'complete' };
    };
    chromeAny.tabs.update = async (tabId: number, updateProperties?: { active?: boolean }) => {
      updateCalls += 1;
      return { id: tabId, windowId: 1, active: Boolean(updateProperties?.active), status: 'complete' };
    };
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-existing-tab', currentMinutes: 0 }]);

    const response = (await dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' })) as {
      success?: boolean;
      opened?: boolean;
    };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(false);
    expect(createCalls).toBe(0);
    expect(updateCalls).toBe(1);
    expect(getAppStateFromStorage().availableGames).toHaveLength(1);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH returns success true when hidden fetch finds games', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    chromeMocks.tabs.setTabsQueryResult([]);
    chromeAny.tabs.create = async ({ url, active }: { url?: string; active?: boolean }) => ({
      id: 888,
      windowId: 1,
      url,
      active: Boolean(active),
      status: 'complete',
    });
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-refresh-success', currentMinutes: 0 }]);

    const response = (await dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' })) as {
      success?: boolean;
      gamesCount?: number;
      appState?: AppState;
    };

    expect(response.success).toBe(true);
    expect(response.gamesCount).toBe(1);
    expect(response.appState?.availableGames).toHaveLength(1);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH shares concurrent refresh work', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    let createCalls = 0;
    chromeMocks.tabs.setTabsQueryResult([]);
    chromeAny.tabs.create = async ({ url }: { url?: string }) => {
      createCalls += 1;
      await sleepTick();
      return { id: 777, windowId: 1, url, status: 'complete' };
    };
    chromeAny.tabs.get = async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chromeAny.tabs.sendMessage = async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-concurrent-open', currentMinutes: 0 }]);

    const [first, second] = (await Promise.all([
      dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' }),
      dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' }),
    ])) as Array<{ success?: boolean; gamesCount?: number }>;

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.gamesCount).toBe(1);
    expect(second.gamesCount).toBe(1);
    expect(createCalls).toBe(1);
  });

  test('SYNC_TWITCH_SESSION from a Twitch tab refreshes empty campaign state', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-session-sync', currentMinutes: 0 }]);

    const response = await dispatchMessage(
      {
        type: 'SYNC_TWITCH_SESSION',
        payload: {
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        },
      },
      { tab: { id: 42, url: 'https://www.twitch.tv/drops/campaigns' } },
    );

    expect(response).toEqual({ success: true });
    expect(getAppStateFromStorage().availableGames).toHaveLength(1);
  });

  test('ENSURE_GAMES_CACHE clears an idle selected campaign with only completed drops', async () => {
    const completedGame: TwitchGame = {
      ...demoGame,
      id: 'completed-idle-game',
      name: 'Completed Idle Game',
      campaignId: 'completed-idle-campaign',
      categorySlug: 'completed-idle-game',
    };
    const completedSnapshot = [
      {
        game: completedGame,
        dropId: 'drop-completed-idle',
        currentMinutes: 60,
        requiredMinutes: 60,
      },
    ];

    enqueueDropsSnapshot(completedSnapshot);
    await syncTestSession();
    enqueueDropsSnapshot(completedSnapshot);
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [completedGame] });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: completedGame } });

    const before = getAppStateFromStorage();
    expect(before.isRunning).toBe(false);
    expect(before.queue).toEqual([]);
    expect(before.selectedGame?.campaignId).toBe(completedGame.campaignId);
    expect(before.pendingDrops).toEqual([]);
    expect(before.completedDrops).toHaveLength(1);
    expect(before.allDrops).toHaveLength(1);

    enqueueDropsSnapshot(completedSnapshot);
    const response = (await dispatchMessage({
      type: 'ENSURE_GAMES_CACHE',
      payload: { force: true },
    })) as { success?: boolean; gamesCount?: number };

    expect(response.success).toBe(true);
    expect(response.gamesCount).toBe(1);

    const after = getAppStateFromStorage();
    expect(after.availableGames).toHaveLength(1);
    expect(after.selectedGame).toBeNull();
    expect(after.currentDrop).toBeNull();
    expect(after.pendingDrops).toEqual([]);
    expect(after.completedDrops).toEqual([]);
    expect(after.allDrops).toEqual([]);
  });

  test('rejects sensitive content-script sync from non-Twitch senders', async () => {
    const before = getAppStateFromStorage().totalChannelPointsClaimed;

    const sessionResponse = await dispatchMessage(
      {
        type: 'SYNC_TWITCH_SESSION',
        payload: {
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        },
      },
      { tab: { id: 666, url: 'https://example.com/not-twitch' } },
    );
    const integrityResponse = await dispatchMessage(
      { type: 'SYNC_TWITCH_INTEGRITY', payload: { token: 'integrity-token', expiration: 0 } },
      { tab: { id: 666, url: 'https://example.com/not-twitch' } },
    );
    const channelPointsResponse = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'bad-sender' } },
      { tab: { id: 666, url: 'https://example.com/not-twitch' } },
    );

    expect(sessionResponse).toEqual({ success: false, error: 'Untrusted message sender' });
    expect(integrityResponse).toEqual({ success: false, error: 'Untrusted message sender' });
    expect(channelPointsResponse).toEqual({ success: false, error: 'Untrusted message sender' });
    expect(getAppStateFromStorage().totalChannelPointsClaimed).toBe(before);
  });

  test('PAUSE_FARMING sets isPaused via chrome.runtime.onMessage.trigger', async () => {
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });

    const state = await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');
    expect(state.isPaused).toBe(true);
  });

  test('RESUME_FARMING clears isPaused after pause', async () => {
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });
    await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');

    chromeMocks.runtime.onMessage.trigger({ type: 'RESUME_FARMING' });
    const resumed = await waitForAppState((next) => next.isPaused === false, 'resume state did not persist');
    expect(resumed.isPaused).toBe(false);
  });

  test('SET_AUTO_RESUME_ON_STARTUP persists the startup resume preference', async () => {
    const enabled = await dispatchMessage({
      type: 'SET_AUTO_RESUME_ON_STARTUP',
      payload: { enabled: true },
    });

    expect(enabled).toEqual({ success: true, autoResumeOnStartup: true });
    expect(getAppStateFromStorage().autoResumeOnStartup).toBe(true);

    const disabled = await dispatchMessage({
      type: 'SET_AUTO_RESUME_ON_STARTUP',
      payload: { enabled: false },
    });

    expect(disabled).toEqual({ success: true, autoResumeOnStartup: false });
    expect(getAppStateFromStorage().autoResumeOnStartup).toBe(false);
  });

  test('SET_NOTIFICATIONS_ENABLED persists the notification preference and suppresses alerts', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    const notifications: unknown[] = [];
    chromeAny.notifications.create = async (options: unknown) => {
      notifications.push(options);
      return 'notification-id';
    };

    const disabled = await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: false },
    });

    expect(disabled).toEqual({ success: true, notificationsEnabled: false });
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);

    const response = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'quiet-channel' } },
      { tab: { id: 123, url: 'https://www.twitch.tv/quiet-channel' } },
    );

    expect(response).toEqual({ success: true });
    expect(notifications).toEqual([]);

    const enabled = await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    expect(enabled).toEqual({
      success: false,
      notificationsEnabled: false,
      error: 'Notification permission was not granted',
    });
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);
  });

  test('SET_NOTIFICATIONS_ENABLED requires optional notification permission before enabling', async () => {
    chromeMocks.permissions.setContainsResult(true);

    const enabled = await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    expect(chromeMocks.permissions._requests).toEqual([]);
    expect(enabled).toEqual({ success: true, notificationsEnabled: true });
    expect(getAppStateFromStorage().notificationsEnabled).toBe(true);
  });

  test('notification alerts are skipped when optional permission is missing', async () => {
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    const notifications: unknown[] = [];
    chromeAny.notifications.create = async (options: unknown) => {
      notifications.push(options);
      return 'notification-id';
    };

    chromeMocks.permissions.setContainsResult(true);
    await dispatchMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: true },
    });

    chromeMocks.permissions.setContainsResult(false);
    const response = await dispatchMessage(
      { type: 'CHANNEL_POINTS_BONUS_CLAIMED', payload: { channelName: 'missing-permission' } },
      { tab: { id: 123, url: 'https://www.twitch.tv/missing-permission' } },
    );

    expect(response).toEqual({ success: true });
    expect(notifications).toEqual([]);
    expect(getAppStateFromStorage().notificationsEnabled).toBe(false);
  });

  test('STOP_FARMING clears running flags and stores terminal stop metadata', async () => {
    chromeMocks.runtime.onMessage.trigger({ type: 'PAUSE_FARMING' });
    await waitForAppState((next) => next.isPaused === true, 'pause state did not persist');

    chromeMocks.runtime.onMessage.trigger({ type: 'STOP_FARMING' });
    const stopped = await waitForAppState(
      (next) => next.isRunning === false && next.isPaused === false,
      'stop state did not persist',
    );

    expect(stopped.lastStopReason).toBe('user-stop');
    expect(stopped.lastStopMessage).toBe('Stopped by user.');
  });

  test('UPDATE_GAMES preserves trusted allDropsCompleted=true when no matching drops exist', async () => {
    const gameWithCompletedMarked = { ...demoGame, allDropsCompleted: true };
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCompletedMarked],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames[0].allDropsCompleted).toBe(true);
  });

  test('UPDATE_GAMES leaves allDropsCompleted=false unchanged when no drops match', async () => {
    const gameWithIncompleteMarked = { ...demoGame, allDropsCompleted: false };
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithIncompleteMarked],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames[0].allDropsCompleted).toBe(false);
  });

  test('UPDATE_GAMES correctly annotates multiple games from UPDATE_GAMES message', async () => {
    const game2: TwitchGame = {
      id: 'game-2',
      name: 'Another Game',
      imageUrl: 'https://example.com/another.png',
      allDropsCompleted: true,
    };

    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [demoGame, game2],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames).toHaveLength(2);
    expect(state.availableGames.some((g) => g.id === 'game-1')).toBe(true);
    expect(state.availableGames.some((g) => g.id === 'game-2')).toBe(true);
    expect(state.availableGames.find((g) => g.id === 'game-2')?.allDropsCompleted).toBe(true);
  });

  test('UPDATE_GAMES updates lastSuccessfulRefreshAt when games are provided', async () => {
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [demoGame],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(typeof state.lastSuccessfulRefreshAt).toBe('number');
    expect(state.lastSuccessfulRefreshAt).toBeGreaterThan(0);
  });

  test('advances queued game when the current campaign vanished mid-farming', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 10,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    enqueueDropsSnapshot([{ game: nextGame, dropId: 'drop-next', currentMinutes: 5 }]);
    enqueueDirectoryResult('streamer-next');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const advanced = await waitForAppState(
      (state) => state.selectedGame?.campaignId === nextGame.campaignId,
      'queue did not advance to the next game after campaign vanished',
    );

    expect(advanced.queue.map((game) => game.name)).toEqual([nextGame.name]);
  });

  test('advances queued game when the current campaign completes mid-farming', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 60,
        requiredMinutes: 60,
      },
    ]);
    enqueueDropsSnapshot([{ game: nextGame, dropId: 'drop-next', currentMinutes: 5 }]);
    enqueueDirectoryResult('streamer-next');

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const advanced = await waitForAppState(
      (state) =>
        state.isRunning &&
        state.selectedGame?.campaignId === nextGame.campaignId &&
        state.activeStreamer?.name === 'streamer-next',
      'queue did not advance to the next game after current campaign completed',
    );

    expect(advanced.queue.map((game) => game.campaignId)).toEqual([nextGame.campaignId]);
    expect(advanced.completedDrops).toEqual([]);
    expect(advanced.pendingDrops[0]?.campaignId).toBe(nextGame.campaignId);
  });

  test('does not advance queue during normal farming when active drops still exist', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 20 }]);

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const state = await waitForAppState(
      (next) => next.selectedGame?.campaignId === demoGame.campaignId,
      'selected game changed unexpectedly during normal farming',
    );

    expect(state.queue.map((game) => game.name)).toEqual([demoGame.name, nextGame.name]);
  });

  test('does not skip the next queued game on its first empty load after advancing', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([
      {
        game: demoGame,
        dropId: 'drop-current',
        currentMinutes: 10,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    enqueueDropsSnapshot([
      {
        game: nextGame,
        dropId: 'drop-next',
        currentMinutes: 5,
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    enqueueDirectoryResult(null);

    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame, thirdGame] });
    await syncTestSession();
    await addGameToQueue(nextGame);
    await addGameToQueue(thirdGame);

    const startResponse = await dispatchMessage({
      type: 'START_FARMING',
      payload: { game: demoGame },
    });

    expect(startResponse).toEqual({ success: true });
    await waitForAppState(
      (state) => state.isRunning && state.selectedGame?.campaignId === demoGame.campaignId,
      'start farming did not stabilize on the current game',
    );

    await triggerMonitorAlarm();

    const state = await waitForAppState(
      (next) => next.selectedGame?.campaignId !== demoGame.campaignId,
      'queue did not leave the vanished current campaign',
    );

    expect(state.selectedGame?.campaignId).toBe(nextGame.campaignId);
    expect(state.queue.map((game) => game.name)).toEqual([nextGame.name, thirdGame.name]);
  });

  test('completes the queue when the last queued game has no live streamers after retry', async () => {
    const realDateNow = Date.now;
    let now = realDateNow();
    Date.now = () => now;

    const notifications: Array<{ title: string; message: string }> = [];
    const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
    const originalCreateNotification = chromeAny.notifications.create;
    chromeAny.notifications.create = async ({ title, message }: { title: string; message: string }) => {
      notifications.push({ title, message });
      return 'notification-id';
    };

    try {
      enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 0 }]);
      enqueueDirectoryResult(null);
      enqueueDirectoryResult(null);
      enqueueDropsSnapshot([{ game: nextGame, dropId: 'drop-next', currentMinutes: 0 }]);
      enqueueDirectoryResult(null);
      enqueueDirectoryResult(null);

      await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame, nextGame] });
      await syncTestSession();
      chromeMocks.permissions.setContainsResult(true);
      await dispatchMessage({
        type: 'SET_NOTIFICATIONS_ENABLED',
        payload: { enabled: true },
      });
      await addGameToQueue(nextGame);

      const startResponse = await dispatchMessage({
        type: 'START_FARMING',
        payload: { game: demoGame },
      });

      expect(startResponse).toEqual({ success: true });
      await waitForAppState(
        (state) =>
          state.isRunning &&
          state.selectedGame?.campaignId === demoGame.campaignId &&
          state.recoveryReason === 'no-streamers',
        'first no-streamers retry was not scheduled',
      );

      now += 61_000;
      await triggerMonitorAlarm();
      await waitForAppState(
        (state) =>
          state.isRunning &&
          state.selectedGame?.campaignId === nextGame.campaignId &&
          state.recoveryReason === 'no-streamers',
        'queue did not advance to the second game and schedule its no-streamers retry',
      );
      for (let i = 0; i < 5; i += 1) {
        await sleepTick();
      }

      now += 61_000;
      await triggerMonitorAlarm();
      const finalState = await waitForAppState(
        (state) => !state.isRunning && state.lastStopReason === 'queue-complete',
        'queue did not complete after the last no-streamers retry failed',
      );

      expect(finalState.isPaused).toBe(false);
      expect(finalState.selectedGame).toBeNull();
      expect(finalState.activeStreamer).toBeNull();
      expect(finalState.tabId).toBeNull();
      expect(finalState.queue).toEqual([]);
      expect(finalState.recoveryReason).toBeNull();
      expect(finalState.recoveryBackoffUntil).toBeNull();
      expect(finalState.recoveryAttempts).toBeNull();
      expect(finalState.lastStopMessage).toContain('Queue completed');
      expect(finalState.lastStopMessage).toContain('No live streamers found');
      expect(notifications.some((notification) => notification.title === 'Queue completed')).toBe(true);
    } finally {
      Date.now = realDateNow;
      chromeAny.notifications.create = originalCreateNotification;
    }
  });

  test('normalizeGameSelection clears selectedGame when exact campaign no longer exists', async () => {
    const gameWithCampaignA: TwitchGame = {
      id: 'game-a',
      name: 'Game With Campaign A',
      imageUrl: 'https://example.com/game-a.png',
      campaignId: 'campaign-a',
      categorySlug: 'game-a',
    };

    const gameWithCampaignB: TwitchGame = {
      id: 'game-b',
      name: 'Game With Campaign B',
      imageUrl: 'https://example.com/game-b.png',
      campaignId: 'campaign-b',
      categorySlug: 'game-b',
    };

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignA],
    });

    await dispatchMessage({
      type: 'SET_SELECTED_GAME',
      payload: { game: gameWithCampaignA },
    });

    let state = getAppStateFromStorage();
    expect(state.selectedGame?.campaignId).toBe('campaign-a');

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignB],
    });

    state = getAppStateFromStorage();
    expect(state.selectedGame).toBeNull();
  });

  test('normalizeQueueSelection removes queue entries when their campaign vanishes', async () => {
    const gameWithCampaignB: TwitchGame = {
      id: 'game-b',
      name: 'Queued Game B',
      imageUrl: 'https://example.com/game-b.png',
      campaignId: 'campaign-b',
      categorySlug: 'game-b',
    };

    const gameWithCampaignC: TwitchGame = {
      id: 'game-c',
      name: 'Game With Campaign C',
      imageUrl: 'https://example.com/game-c.png',
      campaignId: 'campaign-c',
      categorySlug: 'game-c',
    };

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignB],
    });

    await addGameToQueue(gameWithCampaignB);

    let state = getAppStateFromStorage();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].campaignId).toBe('campaign-b');

    // A single snapshot missing the campaign is not enough to prune — guards against a
    // partial/stale post-resume payload wiping the queue on one bad tick.
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignC],
    });

    state = getAppStateFromStorage();
    expect(state.queue).toHaveLength(1);

    // Confirmed missing on a second consecutive snapshot — now it's pruned.
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCampaignC],
    });

    state = getAppStateFromStorage();
    expect(state.queue).toHaveLength(0);
  });

  test('REORDER_QUEUE reorders persisted queue entries when farming is stopped', async () => {
    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [demoGame, nextGame, thirdGame],
    });
    await addGameToQueue(demoGame);
    await addGameToQueue(nextGame);
    await addGameToQueue(thirdGame);

    const response = await dispatchMessage({
      type: 'REORDER_QUEUE',
      payload: { fromIndex: 2, toIndex: 0 },
    });

    expect(response).toEqual({ success: true, reordered: true, queueLength: 3 });

    const state = getAppStateFromStorage();
    expect(state.queue.map((game) => game.campaignId)).toEqual([
      'queue-third-campaign',
      'campaign-1',
      'queue-next-campaign',
    ]);
  });

  test('extension update discards an old volatile reward snapshot before current state reload', async () => {
    // Given
    const chromeAny = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
    const onInstalled = (chromeAny.runtime as Record<string, unknown>).onInstalled as ReturnType<
      typeof createEventMock<{ reason: 'install' | 'update' | 'chrome_update' }>
    >;

    await dispatchMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: true } });
    await dispatchMessage({ type: 'SET_MUTE_FARMING_TAB', payload: { enabled: true } });
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    await dispatchMessage({ type: 'ADD_TO_QUEUE', payload: { game: demoGame } });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: demoGame } });

    const beforeUpdate = getAppStateFromStorage();
    expect(beforeUpdate.queue).toHaveLength(1);
    expect(beforeUpdate.selectedGame?.id).toBe('game-1');
    expect(beforeUpdate.monitorAutoOpen).toBe(true);
    expect(beforeUpdate.muteFarmingTab).toBe(true);

    const oldRewardSemanticField = ['drop', 'Type'].join('');
    const oldRewardSnapshot = {
      id: 'old-reward',
      name: 'Old Reward',
      gameId: 'game-1',
      gameName: 'Demo Game',
      imageUrl: '',
      progress: 45,
      currentMinutes: 27,
      claimed: false,
      [oldRewardSemanticField]: ['time', 'based'].join('-'),
    };
    await chromeMocks.storage.local.set({
      appState: {
        ...beforeUpdate,
        currentDrop: oldRewardSnapshot,
        allDrops: [oldRewardSnapshot],
        pendingDrops: [oldRewardSnapshot],
      },
      [serviceWorkerModule.DROPS_SNAPSHOT_CACHE_KEY]: [oldRewardSnapshot],
      [serviceWorkerModule.TIMING_STATE_KEY]: { lastTrackedDropKey: 'old-reward::campaign-1' },
    });

    // When
    onInstalled.trigger({ reason: 'update' });
    await sleepTick();
    await sleepTick();

    const reloadedState = createServiceWorkerState();
    await loadPersistedState(
      reloadedState,
      {
        onLoadTimingState: async () => {},
        onEnforceInactivityReset: async () => false,
      },
      {
        sanitizeTwitchSession: () => null,
        sessionDebugSummary: () => ({}),
        createInitialState,
        clearRotationMetadata,
        TWITCH_SESSION_STORAGE_KEY: serviceWorkerModule.TWITCH_SESSION_STORAGE_KEY,
        DROPS_SNAPSHOT_CACHE_KEY: serviceWorkerModule.DROPS_SNAPSHOT_CACHE_KEY,
        LAST_ACTIVITY_AT_KEY: serviceWorkerModule.LAST_ACTIVITY_AT_KEY,
        TIMING_STATE_KEY: serviceWorkerModule.TIMING_STATE_KEY,
        STREAM_VALIDATION_GRACE_MS: 0,
      },
    );

    // Then
    expect(reloadedState.cachedDropsSnapshot).toEqual([]);
    expect(reloadedState.appState.currentDrop).toBeNull();
    expect(reloadedState.appState.allDrops).toEqual([]);
    expect(reloadedState.appState.pendingDrops).toEqual([]);
    expect(reloadedState.appState.completedDrops).toEqual([]);
    expect(reloadedState.appState.queue).toHaveLength(1);
    expect(reloadedState.appState.queue[0]?.id).toBe('game-1');
    expect(reloadedState.appState.selectedGame?.id).toBe('game-1');
    expect(reloadedState.appState.monitorAutoOpen).toBe(true);
    expect(reloadedState.appState.muteFarmingTab).toBe(true);
    expect(reloadedState.appState.totalDropsClaimed).toBe(beforeUpdate.totalDropsClaimed);
    expect(chromeMocks.storage.local._store.has(serviceWorkerModule.TIMING_STATE_KEY)).toBe(false);
  });

  test('normalizeGameSelection does not fuzzy-match when campaign ID is explicit but different', async () => {
    const gameNamedDropsWithCampaignC: TwitchGame = {
      id: 'game-drops-c',
      name: 'Drops Game',
      imageUrl: 'https://example.com/drops-c.png',
      campaignId: 'campaign-c',
      categorySlug: 'drops-game',
    };

    const gameNamedDropsWithCampaignC2: TwitchGame = {
      id: 'game-drops-c2',
      name: 'Drops Game',
      imageUrl: 'https://example.com/drops-c2.png',
      campaignId: 'campaign-c2',
      categorySlug: 'drops-game',
    };

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameNamedDropsWithCampaignC],
    });

    await dispatchMessage({
      type: 'SET_SELECTED_GAME',
      payload: { game: gameNamedDropsWithCampaignC },
    });

    let state = getAppStateFromStorage();
    expect(state.selectedGame?.campaignId).toBe('campaign-c');

    await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameNamedDropsWithCampaignC2],
    });

    state = getAppStateFromStorage();
    expect(state.selectedGame).toBeNull();
  });
});
