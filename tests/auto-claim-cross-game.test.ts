import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setupChromeMocks, type ChromeMocks } from './mocks/chrome';
import type { AppState, Message, TwitchGame } from '../src/types/index.ts';
import { setTimingSaveDebounceMsForTests } from '../src/background/state-persistence.ts';

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

await import('../src/background/service-worker.ts?auto-claim-cross-game');

const farmingGame: TwitchGame = {
  id: 'game-farming',
  name: 'Farming Game',
  imageUrl: 'https://example.com/farming.png',
  campaignId: 'campaign-farming',
  categorySlug: 'farming-game',
};

const crossGameOne: TwitchGame = {
  id: 'game-one',
  name: 'Cross Game One',
  imageUrl: 'https://example.com/game-one.png',
  campaignId: 'campaign-one',
  categorySlug: 'cross-game-one',
};

const crossGameTwo: TwitchGame = {
  id: 'game-two',
  name: 'Cross Game Two',
  imageUrl: 'https://example.com/game-two.png',
  campaignId: 'campaign-two',
  categorySlug: 'cross-game-two',
};

const crossGameThree: TwitchGame = {
  id: 'game-three',
  name: 'Cross Game Three',
  imageUrl: 'https://example.com/game-three.png',
  campaignId: 'campaign-three',
  categorySlug: 'cross-game-three',
};

type MockFetchResponse = {
  json: unknown;
  ok?: boolean;
  status?: number;
};

type SnapshotDropSpec = {
  game: TwitchGame;
  dropId: string;
  claimId?: string;
  currentMinutes?: number;
  requiredMinutes?: number | null;
  endsAt?: string;
  claimed?: boolean;
  claimable?: boolean;
};

type SnapshotScenario = {
  drops: SnapshotDropSpec[];
};

const snapshotQueue: SnapshotScenario[] = [];
const directoryQueue: Array<string | null> = [];
const claimRequests: string[] = [];
let activeSnapshotScenario: SnapshotScenario | null = null;

function futureIso(hours = 24) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createRequiredMinutes(spec: SnapshotDropSpec) {
  return spec.requiredMinutes ?? 60;
}

function createCampaignDrop(spec: SnapshotDropSpec) {
  const endsAt = spec.endsAt ?? futureIso();
  return {
    id: spec.dropId,
    name: `${spec.game.name} Reward`,
    requiredMinutesWatched: createRequiredMinutes(spec),
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
  const requiredMinutes = createRequiredMinutes(spec);
  return {
    id: spec.game.campaignId,
    game: {
      displayName: spec.game.name,
      name: spec.game.name,
    },
    timeBasedDrops: [
      {
        id: spec.dropId,
        requiredMinutesWatched: requiredMinutes,
        endAt: spec.endsAt ?? futureIso(),
        self: {
          currentMinutesWatched: spec.currentMinutes ?? (requiredMinutes > 0 ? requiredMinutes : 0),
          isClaimed: spec.claimed ?? false,
          isClaimable: spec.claimable ?? false,
          ...(spec.claimId ? { dropInstanceID: spec.claimId } : {}),
        },
      },
    ],
  };
}

function createSeedDrop(game: TwitchGame = farmingGame): SnapshotDropSpec {
  return {
    game,
    dropId: `${game.campaignId}-seed-drop`,
    currentMinutes: 10,
    requiredMinutes: 60,
    claimed: false,
    claimable: false,
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
        throw new Error('Unexpected campaign details fetch in auto-claim-cross-game test');
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
          throw new Error('Unexpected drops dashboard fetch in auto-claim-cross-game test');
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
          throw new Error('Unexpected inventory fetch in auto-claim-cross-game test');
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
          throw new Error('Unexpected directory fetch in auto-claim-cross-game test');
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
        const claimId = body?.variables?.input?.dropInstanceID;
        if (typeof claimId === 'string' && claimId.length > 0) {
          claimRequests.push(claimId);
        }
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
        throw new Error(`Unexpected fetch operation in auto-claim-cross-game test: ${body?.operationName ?? 'unknown'}`);
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

async function sleepTicks(count = 1) {
  for (let attempt = 0; attempt < count; attempt += 1) {
    await sleepTick();
  }
}

async function resetModuleState() {
  const chromeAny = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
  chromeMocks.storage.local._store.clear();
  chromeMocks.storage.session._store.clear();
  chromeAny.runtime.onInstalled.trigger({ reason: 'update' });
  await sleepTicks(5);
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

async function waitForCondition(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) {
      return;
    }
    await sleepTick();
  }
  throw new Error(message);
}

async function dispatchMessage(message: Message, sender: chrome.runtime.MessageSender = {}): Promise<unknown> {
  const handler = chromeMocks.runtime.onMessage._handlers[0];
  if (!handler) {
    throw new Error('service worker onMessage handler not registered');
  }

  return new Promise((resolve) => {
    handler(message, sender, (response?: unknown) => resolve(response));
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
  }, {
    tab: {
      id: 999,
      url: 'https://www.twitch.tv/drops/campaigns',
    },
  });
}

async function triggerMonitorAlarm() {
  chromeMocks.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: Date.now() });
  await sleepTick();
}

async function triggerMonitorAlarmForScenario(dropSpecs: SnapshotDropSpec[], postClaimDropSpecs?: SnapshotDropSpec[]) {
  enqueueDropsSnapshot(dropSpecs);
  if (postClaimDropSpecs) {
    enqueueDropsSnapshot(postClaimDropSpecs);
  }
  await triggerMonitorAlarm();
}

async function startRunningFarm() {
  const seedDrop = createSeedDrop();
  enqueueDropsSnapshot([seedDrop]);
  enqueueDirectoryResult('streamer-seed');
  enqueueDropsSnapshot([seedDrop]);

  await syncTestSession();

  const startResponse = await dispatchMessage({
    type: 'START_FARMING',
    payload: { game: farmingGame },
  });

  expect(startResponse).toEqual({ success: true });
  await waitForAppState(
    (state) => state.isRunning && state.selectedGame?.campaignId === farmingGame.campaignId,
    'start farming did not stabilize on the seed game',
  );

  await sleepTicks(5);
  snapshotQueue.length = 0;
  activeSnapshotScenario = null;
}

async function refreshToScenario(dropSpecs: SnapshotDropSpec[]) {
  enqueueDropsSnapshot(dropSpecs);
  const response = await dispatchMessage({ type: 'REFRESH_DROPS' });
  expect(response).toEqual({ success: true });
  await waitForCondition(
    () => snapshotQueue.length === 0 && activeSnapshotScenario === null,
    'refresh did not settle on the staged snapshot',
  );
}

describe('auto-claim cross-game alarm integration', () => {
  beforeEach(async () => {
    snapshotQueue.length = 0;
    directoryQueue.length = 0;
    claimRequests.length = 0;
    activeSnapshotScenario = null;
    installFetchMock();
    installActiveTabMocks();
    await resetModuleState();
    await resetWorkerState();
    await dispatchMessage({ type: 'SET_AUTO_CLAIM_DROPS', payload: { enabled: true } });
  });

  afterEach(() => {
    chromeMocks.storage.session._store.clear();
  });

  afterAll(() => {
    chromeMocks.teardown();
  });

  test('Toggle OFF → trigger alarm → totalDropsClaimed stays 0', async () => {
    await startRunningFarm();
    const baselineClaims = getAppStateFromStorage().totalDropsClaimed;

    const disabled = await dispatchMessage({
      type: 'SET_AUTO_CLAIM_DROPS',
      payload: { enabled: false },
    });
    expect(disabled).toEqual({ success: true, autoClaimDrops: false });

    await refreshToScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'cross-game-one-drop',
        claimId: 'claim-cross-game-one',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
    ]);

    await triggerMonitorAlarmForScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'cross-game-one-drop',
        claimId: 'claim-cross-game-one',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
    ]);
    await sleepTicks(5);

    expect(getAppStateFromStorage().totalDropsClaimed).toBe(baselineClaims);
    expect(claimRequests).toHaveLength(0);
  });

  test('Toggle ON → trigger alarm with 1 claimable time-based drop → totalDropsClaimed becomes 1', async () => {
    await startRunningFarm();
    const baselineClaims = getAppStateFromStorage().totalDropsClaimed;

    await refreshToScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'claimable-time-drop',
        claimId: 'claim-time-drop',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
    ]);
    const claimableScenario = [
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'claimable-time-drop',
        claimId: 'claim-time-drop',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
    ];
    const claimedScenario = [
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'claimable-time-drop',
        claimId: 'claim-time-drop',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: true,
        claimable: false,
      },
    ];

    await triggerMonitorAlarmForScenario(claimableScenario, claimedScenario);

    await waitForAppState(
      (state) => state.totalDropsClaimed === baselineClaims + 1,
      'claim counter did not increment by 1',
    );
    expect(claimRequests).toEqual(['claim-time-drop']);
  });

  test('Toggle ON → trigger alarm with 3 claimable drops from 3 games → totalDropsClaimed becomes 3', async () => {
    await startRunningFarm();
    const baselineClaims = getAppStateFromStorage().totalDropsClaimed;

    await refreshToScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'cross-drop-one',
        claimId: 'claim-cross-one',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
      {
        game: crossGameTwo,
        dropId: 'cross-drop-two',
        claimId: 'claim-cross-two',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
      {
        game: crossGameThree,
        dropId: 'cross-drop-three',
        claimId: 'claim-cross-three',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
    ]);
    const claimableScenario = [
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'cross-drop-one',
        claimId: 'claim-cross-one',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
      {
        game: crossGameTwo,
        dropId: 'cross-drop-two',
        claimId: 'claim-cross-two',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
      {
        game: crossGameThree,
        dropId: 'cross-drop-three',
        claimId: 'claim-cross-three',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: false,
        claimable: true,
      },
    ];
    const claimedScenario = [
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'cross-drop-one',
        claimId: 'claim-cross-one',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: true,
        claimable: false,
      },
      {
        game: crossGameTwo,
        dropId: 'cross-drop-two',
        claimId: 'claim-cross-two',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: true,
        claimable: false,
      },
      {
        game: crossGameThree,
        dropId: 'cross-drop-three',
        claimId: 'claim-cross-three',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: true,
        claimable: false,
      },
    ];

    await triggerMonitorAlarmForScenario(claimableScenario, claimedScenario);

    await waitForAppState(
      (state) => state.totalDropsClaimed === baselineClaims + 3,
      'claim counter did not increment by 3',
    );
    expect(claimRequests).toEqual(['claim-cross-one', 'claim-cross-two', 'claim-cross-three']);
  });

  test('Toggle ON → trigger alarm with 1 event-based claimable drop → totalDropsClaimed stays 0', async () => {
    await startRunningFarm();
    const baselineClaims = getAppStateFromStorage().totalDropsClaimed;

    await refreshToScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'event-based-drop',
        claimId: 'claim-event-based',
        currentMinutes: 0,
        requiredMinutes: 0,
        claimed: false,
        claimable: true,
      },
    ]);

    await triggerMonitorAlarmForScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'event-based-drop',
        claimId: 'claim-event-based',
        currentMinutes: 0,
        requiredMinutes: 0,
        claimed: false,
        claimable: true,
      },
    ]);
    await sleepTicks(5);

    expect(getAppStateFromStorage().totalDropsClaimed).toBe(baselineClaims);
    expect(claimRequests).toHaveLength(0);
  });

  test('Toggle ON → trigger alarm with 1 already-claimed drop → totalDropsClaimed stays 0', async () => {
    await startRunningFarm();
    const baselineClaims = getAppStateFromStorage().totalDropsClaimed;

    await refreshToScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'already-claimed-drop',
        claimId: 'claim-already-claimed',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: true,
        claimable: true,
      },
    ]);

    await triggerMonitorAlarmForScenario([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'already-claimed-drop',
        claimId: 'claim-already-claimed',
        currentMinutes: 60,
        requiredMinutes: 60,
        claimed: true,
        claimable: true,
      },
    ]);
    await sleepTicks(5);

    expect(getAppStateFromStorage().totalDropsClaimed).toBe(baselineClaims);
    expect(claimRequests).toHaveLength(0);
  });

  test('Toggle ON → trigger alarm with empty snapshot → no errors and totalDropsClaimed stays 0', async () => {
    await startRunningFarm();
    const baselineClaims = getAppStateFromStorage().totalDropsClaimed;

    await refreshToScenario([]);

    await triggerMonitorAlarmForScenario([]);
    await sleepTicks(5);

    const state = getAppStateFromStorage();
    expect(state.isRunning).toBe(true);
    expect(state.totalDropsClaimed).toBe(baselineClaims);
    expect(claimRequests).toHaveLength(0);
  });
});
