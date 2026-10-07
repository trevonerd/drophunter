import { expect, test } from 'bun:test';
import { createChromeFarmingAutomationHost } from '../src/background/farming-automation-chrome-host.ts';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { listManagedWatches } from '../src/background/managed-watch-registry.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerBrowserEvents } from '../src/background/service-worker-browser-events.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

test('Stop during the final native creation proof retains and pauses the owned tab without handing off a candidate', async () => {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  let nativeKey: string | undefined;
  const nativeSet = mocks.chrome.storage.session.set;
  mocks.chrome.storage.session.set = async (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'object' || value === null) continue;
      if ('opening' in value && value.opening === true) nativeKey = key;
      else if (key === nativeKey) {
        entered.resolve();
        await release.promise;
      }
    }
    await nativeSet(values);
  };
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.manualQueueAuthorized = true;
  state.appState.farmingSessionOrigin = 'manual';
  state.appState.selectedGame = createGame();
  const events = createServiceWorkerBrowserEvents(state, {
    ensureContentScriptOnTab: async () => {},
    fetchStreamContext: async () => null,
    heartbeat: async () => ({ accepted: false }),
    notify: async () => {},
    notifyQueueComplete: async () => {},
    clearQueueCompleteNotification: async () => {},
  });
  const session = createFarmingSession(
    state,
    createFarmingSessionAdapters({ watchTransport: events.watchTransport }),
  );
  const host = createChromeFarmingAutomationHost();
  const acquiring = host.managedWatchOwnership.acquire('owned_channel', {
    allowInitialCreation: true,
    isCurrent: () => state.appState.isRunning && state.appState.lastStopReason !== 'user-stop',
  });
  try {
    await entered.promise;
    const page = tabs.pages.get(20);
    if (!page) throw new Error('Missing newly created tab');
    page.playing = true;
    expect(page.storage.size).toBe(0);
    await session.handleStopFarming();
    expect(page.playing).toBe(true);
    release.resolve();

    expect(await acquiring).toBeNull();
    expect(page.playing).toBe(false);
    expect(page.storage.size).toBe(1);
    expect(
      await host.managedWatchOwnership.reconstruct(
        null,
        () => ({ running: false, activeChannel: null, tabId: null }),
        () => true,
      ),
    ).toMatchObject({ kind: 'managed-tab', tabId: 20, expectedChannel: 'owned_channel' });
    expect(await listManagedWatches()).toHaveLength(1);
    expect(tabs.created).toEqual([20]);
    expect(tabs.removed).toEqual([]);
    expect(state.appState.isRunning).toBe(false);
    expect(state.appState.lastStopReason).toBe('user-stop');
  } finally {
    release.resolve();
    await acquiring.catch(() => null);
    mocks.teardown();
  }
});
