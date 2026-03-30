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

describe('service worker message handlers', () => {
  beforeEach(async () => {
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
});
