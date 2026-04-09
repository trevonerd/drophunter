import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setupChromeMocks, type ChromeMocks } from './mocks/chrome';
import type { AppState, Message, TwitchGame } from '../src/types/index.ts';

const chromeMocks = setupChromeMocks();

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

  chromeAny.scripting = {
    executeScript: async () => [],
  };

  chromeAny.cookies = {
    get: async () => null,
  };

  chromeAny.storage.session.remove = async () => undefined;
  chromeAny.storage.sync = syncStorage;
  chromeAny.storage.local.remove = async (keys: string | string[]) => {
    if (Array.isArray(keys)) {
      keys.forEach((key) => chromeMocks.storage.local._store.delete(key));
      return;
    }
    chromeMocks.storage.local._store.delete(keys);
  };

  mocks.tabs.setTabsQueryResult([]);
}

installServiceWorkerSupportMocks(chromeMocks);

await import('../src/background/service-worker.ts');

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

    const jsonResponse = (json: unknown, options: Omit<MockFetchResponse, 'json'> = {}) => ({
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
        const scenario = activeSnapshotScenario;
        if (!scenario) {
          throw new Error('Unexpected inventory fetch in service-worker test');
        }
        if (scenario.drops.length === 0) {
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
        throw new Error(`Unexpected fetch operation in service-worker test: ${body?.operationName ?? 'unknown'}`);
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

async function dispatchMessage(message: Message): Promise<unknown> {
  const handler = chromeMocks.runtime.onMessage._handlers[0];
  if (!handler) {
    throw new Error('service worker onMessage handler not registered');
  }

  return new Promise((resolve) => {
    handler(message, {}, (response?: unknown) => resolve(response));
  });
}

async function resetWorkerState() {
  await dispatchMessage({ type: 'STOP_FARMING' });
  await dispatchMessage({ type: 'CLEAR_QUEUE' });
  await dispatchMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
}

async function syncTestSession() {
  await dispatchMessage({
    type: 'SYNC_TWITCH_SESSION',
    payload: {
      session: {
        oauthToken: 'oauth-token-with-valid-length-1234567890',
        userId: '123456',
        deviceId: 'device-12345678',
        uuid: 'uuid-1',
      },
    },
  });
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
    installFetchMock();
    installActiveTabMocks();
    await resetWorkerState();
  });

  afterEach(() => {
    chromeMocks.storage.session._store.clear();
  });

  afterAll(() => {
    chromeMocks.teardown();
  });

  test('registers runtime onMessage listener at module load', () => {
    expect(chromeMocks.runtime.onMessage._handlers.length).toBeGreaterThan(0);
  });

  test('START_FARMING returns an error when no game is provided', async () => {
    const response = await dispatchMessage({ type: 'START_FARMING' });

    expect(response).toEqual({ success: false, error: 'No game selected.' });
    expect(getAppStateFromStorage().isRunning).toBe(false);
  });

  test('START_FARMING exits cleanly when no farmable drops are available', async () => {
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

  test('UPDATE_GAMES annotates game with allDropsCompleted=true to false when no matching drops', async () => {
    const gameWithCompletedMarked = { ...demoGame, allDropsCompleted: true };
    const response = await dispatchMessage({
      type: 'UPDATE_GAMES',
      payload: [gameWithCompletedMarked],
    });

    expect(response).toEqual({ success: true });

    const state = getAppStateFromStorage();
    expect(state.availableGames[0].allDropsCompleted).toBe(false);
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
    expect(state.availableGames.find((g) => g.id === 'game-2')?.allDropsCompleted).toBe(false);
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

  test('does not advance queue during normal farming when active drops still exist', async () => {
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDirectoryResult('streamer-current');
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 10 }]);
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-current', currentMinutes: 20 }]);

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
});
