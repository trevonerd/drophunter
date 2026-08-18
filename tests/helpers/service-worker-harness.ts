import {
  clearPendingTimingStateSaveForTests,
  setTimingSaveDebounceMsForTests,
} from '../../src/background/state-persistence.ts';
import { normalizeStoredAppState } from '../../src/shared/app-state-sync.ts';
import type { RuntimeRequest, RuntimeResponseByType } from '../../src/shared/messages.ts';
import type { AppState, TwitchGame } from '../../src/types/index.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';
import type { MessageSender } from '../mocks/chrome-types.ts';
import { installFetchMock, resetFetchScenarios } from './service-worker-fetch.ts';

const originalFetch = globalThis.fetch;
export const chromeMocks = setupChromeMocks();
setTimingSaveDebounceMsForTests(0);

export const serviceWorkerModule = await import('../../src/background/service-worker.ts');
serviceWorkerModule.startServiceWorker();

export function installActiveTabMocks() {
  chromeMocks.chrome.tabs.create = async ({ url }) => ({
    id: 999,
    windowId: 1,
    url: url ?? 'https://www.twitch.tv/test-streamer',
    status: 'complete',
  });
  chromeMocks.chrome.tabs.update = async (tabId, updateProperties) => ({
    id: tabId,
    windowId: 1,
    url: updateProperties?.url ?? 'https://www.twitch.tv/test-streamer',
    active: Boolean(updateProperties?.active),
    status: 'complete',
  });
  chromeMocks.chrome.tabs.get = async (tabId) => ({
    id: tabId,
    windowId: 1,
    url: 'https://www.twitch.tv/test-streamer',
    status: 'complete',
  });
  chromeMocks.chrome.tabs.sendMessage = async (_tabId, message) => {
    if (message.type === 'PREPARE_STREAM_PLAYBACK') {
      return { success: true, isPlaybackReady: true, userInteractionRequired: false };
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
  await dispatchMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled: false } });
  await dispatchMessage({ type: 'SET_AUTO_RESUME_ON_STARTUP', payload: { enabled: false } });
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

export function afterEachServiceWorkerTest() {
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

export async function addGameToQueue(game: TwitchGame) {
  await dispatchMessage({ type: 'ADD_TO_QUEUE', payload: { game } });
}

export async function triggerMonitorAlarm() {
  chromeMocks.alarms.onAlarm.trigger({ name: 'dropCheck', scheduledTime: Date.now() });
  await sleepTick();
}
