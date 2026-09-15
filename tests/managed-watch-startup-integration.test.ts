import { expect, test } from 'bun:test';
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
    const browserEvents = createServiceWorkerBrowserEvents(state, {
      ensureContentScriptOnTab: async () => {},
      fetchStreamContext: async () => null,
      heartbeat: async () => ({ accepted: false }),
      notify: async () => {},
      notifyQueueComplete: async () => {},
      clearQueueCompleteNotification: async () => {},
    });
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
    expect(page.url).toBe('about:blank');
  } finally {
    mocks.teardown();
  }
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
    expect(page.url).toBe('about:blank');
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
