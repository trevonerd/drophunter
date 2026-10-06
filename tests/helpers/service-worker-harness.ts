import {
  readManagedWatchMarkerInPage,
  writeManagedWatchMarkerInPage,
} from '../../src/background/managed-watch-marker.ts';
import {
  clearPendingTimingStateSaveForTests,
  setTimingSaveDebounceMsForTests,
} from '../../src/background/state-persistence.ts';
import { normalizeStoredAppState } from '../../src/shared/app-state-sync.ts';
import type { RuntimeRequest, RuntimeResponseByType } from '../../src/shared/messages.ts';
import type { AppState, TwitchGame } from '../../src/types/index.ts';
import { demoGame, nextGame, thirdGame } from '../fixtures/service-worker-games.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import type { MessageSender } from '../mocks/chrome-types.ts';
import { installManagedWatchPages } from '../support/managed-watch-pages.ts';
import { installFetchMock, resetFetchScenarios } from './service-worker-fetch.ts';

const originalFetch = globalThis.fetch;
export const chromeMocks = setupChromeMocks();
const defaultQueryTabs = chromeMocks.chrome.tabs.query;
const defaultExecuteScript = chromeMocks.chrome.scripting.executeScript;
const closedManagedTabIds = new Set<number>();
let nextManagedTabId = 999;
let activeManagedPages: ReturnType<typeof installManagedWatchPages> | null = null;
setTimingSaveDebounceMsForTests(0);

export const serviceWorkerModule = await import('../../src/background/service-worker.ts');
serviceWorkerModule.startServiceWorker();

export function installActiveTabMocks() {
  const pages = installManagedWatchPages(chromeMocks);
  activeManagedPages = pages;
  const executePageScript = chromeMocks.chrome.scripting.executeScript;
  const getPage = chromeMocks.chrome.tabs.get;
  chromeMocks.chrome.tabs.query = defaultQueryTabs;
  chromeMocks.chrome.tabs.create = async ({ url }) =>
    pages.add(url ?? 'https://www.twitch.tv/test-streamer', nextManagedTabId++);
  chromeMocks.chrome.tabs.get = async (tabId) => {
    if (pages.pages.has(tabId)) return getPage(tabId);
    if (closedManagedTabIds.has(tabId)) throw new Error(`tab ${tabId} was closed`);
    return { id: tabId, windowId: 1, url: 'https://www.twitch.tv/test-streamer', status: 'complete' };
  };
  chromeMocks.chrome.scripting.executeScript = async (options) => {
    if (options.func === writeManagedWatchMarkerInPage || options.func === readManagedWatchMarkerInPage)
      return executePageScript(options);
    return defaultExecuteScript(options);
  };
  chromeMocks.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === 'PREPARE_STREAM_PLAYBACK') {
      return { success: true, isPlaybackReady: true, userInteractionRequired: false };
    }
    if (message.type === 'GET_STREAM_CONTEXT') {
      const page = pages.pages.get(tabId);
      if (!page) return { success: false };
      const channelName = new URL(page.url).pathname.split('/')[1] ?? '';
      const game = channelName.includes('next')
        ? nextGame
        : channelName.includes('third')
          ? thirdGame
          : demoGame;
      return {
        success: true,
        context: {
          channelName,
          categorySlug: game.categorySlug,
          categoryLabel: game.name,
          streamTitle: 'Drops enabled',
          titleContainsDrops: true,
          hasDropsSignal: true,
          isLive: true,
          isPlaybackReady: true,
          pageUrl: page.url,
        },
      };
    }
    return { success: false };
  };
}

export function getAppStateFromStorage(): AppState {
  return normalizeStoredAppState(chromeMocks.storage.local._store.get('appState'));
}

export function sleepTick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function waitForAppState(
  check: (state: AppState) => boolean,
  message: string,
): Promise<AppState> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = getAppStateFromStorage();
    if (check(state)) return state;
    await sleepTick();
  }
  throw new Error(message);
}

export async function dispatchMessage<T extends RuntimeRequest>(
  message: T,
  sender: MessageSender = {},
): Promise<RuntimeResponseByType[T['type']]> {
  return dispatchMessageFromMocks(chromeMocks, message, sender);
}

export async function dispatchMessageFromMocks<T extends RuntimeRequest>(
  mocks: typeof chromeMocks,
  message: T,
  sender: MessageSender = {},
): Promise<RuntimeResponseByType[T['type']]> {
  const handler = mocks.runtime.onMessage._handlers[0];
  if (!handler) throw new Error('service worker onMessage handler not registered');
  return new Promise((resolve) => {
    handler(message, sender, (response) => resolve(response as RuntimeResponseByType[T['type']]));
  });
}

export async function resetWorkerState() {
  await dispatchMessage({ type: 'STOP_FARMING' });
  await dispatchMessage({ type: 'CLEAR_QUEUE' });
  serviceWorkerModule.resetCampaignEvidenceForTests();
  await dispatchMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
}

export async function beforeEachServiceWorkerTest() {
  resetFetchScenarios();
  chromeMocks.permissions.setContainsResult(false);
  chromeMocks.permissions.setRequestResult(false);
  chromeMocks.permissions._requests.length = 0;
  installFetchMock();
  installActiveTabMocks();
  await resetWorkerState();
}

export async function afterEachServiceWorkerTest() {
  const pages = activeManagedPages;
  activeManagedPages = null;
  if (pages) {
    const closedTabIds = [...pages.pages.keys()];
    for (const tabId of closedTabIds) {
      pages.pages.delete(tabId);
      closedManagedTabIds.add(tabId);
    }
    await Promise.all(
      closedTabIds.flatMap((tabId) =>
        chromeMocks.chrome.tabs.onRemoved._handlers.map((handler) => Promise.resolve(handler(tabId))),
      ),
    );
  }
  chromeMocks.storage.session._store.clear();
}

export async function teardownServiceWorkerTests() {
  await sleepTick();
  clearPendingTimingStateSaveForTests();
  setTimingSaveDebounceMsForTests(null);
  chromeMocks.teardown();
  globalThis.fetch = originalFetch;
}

export async function syncTestSession() {
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

export async function syncTestSessionWithoutCampaignRefresh() {
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
    { url: 'https://www.twitch.tv/drops/campaigns' },
  );
}

export async function addGameToQueue(game: TwitchGame) {
  await dispatchMessage({ type: 'ADD_TO_QUEUE', payload: { game } });
}

export async function triggerMonitorAlarm() {
  chromeMocks.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: Date.now() });
  await sleepTick();
}

export async function triggerInventoryRefreshAlarm() {
  serviceWorkerModule.setLastInventoryRefreshAtForTests(0);
  await triggerMonitorAlarm();
}
