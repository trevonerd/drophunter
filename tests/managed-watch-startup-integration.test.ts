import { expect, test } from 'bun:test';
import { createFarmingAutomationBrowser } from '../src/background/farming-automation-browser.ts';
import type { WatchOwnershipV1 } from '../src/background/farming-automation-contracts.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { managedWatchMarker } from '../src/background/managed-watch-marker.ts';
import { openOwnedManagedWatch } from '../src/background/managed-watch-open.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { reconcileManagedWatchesOnStartup } from '../src/background/managed-watch-startup.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { assembleServiceWorkerFarmingAutomation } from '../src/background/service-worker-farming-automation-assembly.ts';
import { createFarmingSessionAdapters, createGame, createStreamer } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

const url = 'https://www.twitch.tv/test_streamer';
function runningState() {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.watchTransportPreference = 'managed-tab';
  state.appState.selectedGame = createGame();
  state.appState.activeStreamer = createStreamer({ name: 'test_streamer' });
  state.appState.tabId = 20;
  return state;
}

function browserEventsFor(state: ReturnType<typeof runningState>) {
  return createServiceWorkerBrowserEvents(state, {
    ensureContentScriptOnTab: async () => {},
    fetchStreamContext: async () => null,
    heartbeat: async () => ({ accepted: false }),
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

async function withManagedIncumbent(run: (subject: ManagedWatchSubject) => Promise<void>): Promise<void> {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  try {
    const state = runningState();
    const browserEvents = browserEventsFor(state);
    await browserEvents.watchTransport.start(createStreamer({ name: 'first_streamer' }));
    const incumbent = browserEvents.watchTransport.currentOwnership();
    expect(incumbent?.kind).toBe('managed-tab');
    if (incumbent?.kind !== 'managed-tab') throw new Error('Expected managed ownership');
    await run({ mocks, tabs, state, browserEvents, incumbent });
  } finally {
    mocks.teardown();
  }
}

function automationBrowserFor(
  browserEvents: ReturnType<typeof browserEventsFor>,
  isPlaybackReady: boolean,
  ownershipToken: string,
) {
  return createFarmingAutomationBrowser({
    watchRuntime: browserEvents.watchTransport,
    watch: {
      tablessEnabled: true,
      heartbeat: async () => ({ accepted: true }),
      waitForTabComplete: async () => {},
      preparePlayback: async () => ({ isPlaybackReady, userInteractionRequired: !isPlaybackReady }),
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

test('actual automation assembly restores ordinary managed watch after same-version browser restart without creating a tab', async () => {
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
    const browserEvents = browserEventsFor(state);
    let creates = 0;
    mocks.chrome.tabs.create = async () => {
      creates++;
      throw new Error('Must restore before acquire');
    };
    await assembleServiceWorkerFarmingAutomation(state, {
      browserEvents,
      startMonitoring: () => {},
      twitchGateway: {
        ensureTwitchSession: async () => null,
        fetchDirectoryStreamers: async () => [],
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

test('failed in-place handoff restores the incumbent streamer in the same tab', async () => {
  await withManagedIncumbent(async ({ tabs, browserEvents, incumbent }) => {
    const automationBrowser = automationBrowserFor(browserEvents, false, 'rejected-owned');

    expect(await automationBrowser.watch.prepare(nextTarget, 'managed-tab')).toEqual({
      kind: 'failed',
      reason: 'candidate-unavailable',
    });

    expect(browserEvents.watchTransport.currentOwnership()).toEqual(incumbent);
    expect([...tabs.pages.values()].map((page) => ({ id: page.id, url: page.url }))).toEqual([
      { id: incumbent.tabId, url: 'https://www.twitch.tv/first_streamer' },
    ]);
    expect(tabs.removed).toEqual([]);
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
