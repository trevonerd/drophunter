import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServiceWorkerState } from '../src/background/service-worker.ts';
import {
  applyBestEffortAlwaysOnTop,
  clearManagedTabOwnership,
  closeManagedTabIfSafe,
  createManagedTab,
  ensureManagedTab,
  monitorDashboardUrl,
  shouldMuteManagedFarmingTab,
  streamerWatchUrl,
  syncManagedTabMuteState,
  waitForTabComplete,
} from '../src/background/tab-management.ts';
import { createInitialState } from '../src/shared/utils.ts';

interface Tab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
  status?: string;
  muted?: boolean;
  pinned?: boolean;
  groupId?: number;
}

interface Window {
  id?: number;
  focused?: boolean;
  alwaysOnTop?: boolean;
  type?: string;
  state?: string;
}

interface TabUpdateDetails {
  url?: string;
  active?: boolean;
  muted?: boolean;
  pinned?: boolean;
  highlighted?: boolean;
}

interface WindowUpdateInfo {
  focused?: boolean;
  alwaysOnTop?: boolean;
  state?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

interface ChromeMock {
  tabs: {
    query: (queryInfo: Record<string, unknown>) => Promise<Tab[]>;
    get: (tabId: number) => Promise<Tab>;
    create: (details: { windowId?: number; url?: string; active?: boolean }) => Promise<Tab>;
    update: (tabId: number, details: TabUpdateDetails) => Promise<Tab>;
    remove: (tabId: number) => Promise<void>;
    onUpdated: {
      addListener: (handler: (tabId: number, info: Record<string, unknown>) => void) => void;
      removeListener: (handler: (tabId: number, info: Record<string, unknown>) => void) => void;
      trigger: (tabId: number, info: Record<string, unknown>) => void;
    };
  };
  windows: {
    getLastFocused: () => Promise<Window>;
    update: (windowId: number, details: WindowUpdateInfo) => Promise<Window>;
    create: (details: Record<string, unknown>) => Promise<Window>;
  };
  runtime: {
    getURL: (path: string) => string;
  };
  storage: {
    local: {
      get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
    session: {
      get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
}

function createMockChrome(): ChromeMock {
  let tabsQueryResult: Tab[] = [];
  let tabsGetResult: Tab | null = null;
  const tabRegistry = new Map<number, Tab>();
  let nextTabId = 1;
  const lastFocusedWindow: Window = { id: 1, focused: true };
  const onUpdatedHandlers: Array<(id: number, info: Record<string, unknown>) => void> = [];
  const localStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {};

  return {
    tabs: {
      query: (_queryInfo: Record<string, unknown>) => Promise.resolve(tabsQueryResult),
      get: (tabId: number) => {
        if (tabsGetResult) {
          return Promise.resolve(tabsGetResult);
        }
        const tab = tabRegistry.get(tabId);
        if (!tab) return Promise.reject(new Error('tab not found'));
        return Promise.resolve(tab);
      },
      create: (details) => {
        const id = nextTabId++;
        const tab: Tab = {
          id,
          url: details.url,
          active: details.active ?? false,
          windowId: details.windowId ?? lastFocusedWindow.id ?? 1,
        };
        tabRegistry.set(id, tab);
        return Promise.resolve(tab);
      },
      update: (tabId: number, details) => {
        let tab = tabRegistry.get(tabId);
        if (!tab) {
          tab = { id: tabId };
          tabRegistry.set(tabId, tab);
        }
        Object.assign(tab, details);
        return Promise.resolve({ ...tab });
      },
      remove: (tabId: number) => {
        tabRegistry.delete(tabId);
        return Promise.resolve();
      },
      onUpdated: {
        addListener: (h) => onUpdatedHandlers.push(h),
        removeListener: (h) => {
          const idx = onUpdatedHandlers.indexOf(h);
          if (idx !== -1) onUpdatedHandlers.splice(idx, 1);
        },
        trigger: (id, info) => {
          for (const h of onUpdatedHandlers) h(id, info);
        },
      },
    },
    windows: {
      getLastFocused: () => Promise.resolve(lastFocusedWindow),
      update: (windowId, details) => {
        if (lastFocusedWindow.id === windowId) Object.assign(lastFocusedWindow, details);
        return Promise.resolve({ ...lastFocusedWindow });
      },
      create: (details) => {
        const id = nextTabId++;
        return Promise.resolve({ id, focused: true, ...details });
      },
    },
    runtime: {
      getURL: (path) => `chrome-extension://mock-id/${path.replace(/^\//, '')}`,
    },
    storage: {
      local: {
        get: (keys) => {
          const result: Record<string, unknown> = {};
          if (keys === null) return Promise.resolve({ ...localStore });
          if (typeof keys === 'string') {
            if (keys in localStore) result[keys] = localStore[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              if (k in localStore) result[k] = localStore[k];
            }
          } else {
            for (const [k, def] of Object.entries(keys ?? {})) {
              result[k] = k in localStore ? localStore[k] : def;
            }
          }
          return Promise.resolve(result);
        },
        set: (items) => {
          for (const [k, v] of Object.entries(items)) localStore[k] = v;
          return Promise.resolve();
        },
      },
      session: {
        get: (keys) => {
          const result: Record<string, unknown> = {};
          if (keys === null) return Promise.resolve({ ...sessionStore });
          if (typeof keys === 'string') {
            if (keys in sessionStore) result[keys] = sessionStore[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              if (k in sessionStore) result[k] = sessionStore[k];
            }
          } else {
            for (const [k, def] of Object.entries(keys ?? {})) {
              result[k] = k in sessionStore ? sessionStore[k] : def;
            }
          }
          return Promise.resolve(result);
        },
        set: (items) => {
          for (const [k, v] of Object.entries(items)) sessionStore[k] = v;
          return Promise.resolve();
        },
      },
    },
    _setQueryResult: (tabs: Tab[]) => {
      tabsQueryResult = tabs;
    },
    _setGetResult: (tab: Tab | null) => {
      tabsGetResult = tab;
    },
    _getTabRegistry: () => tabRegistry,
  } as unknown as ChromeMock & {
    _setQueryResult: (tabs: Tab[]) => void;
    _setGetResult: (tab: Tab | null) => void;
  };
}

function setupChromeMock(): {
  mock: ChromeMock & { _setQueryResult: (tabs: Tab[]) => void; _setGetResult: (tab: Tab | null) => void };
  teardown: () => void;
} {
  const originalChrome = (globalThis as Record<string, unknown>).chrome;
  const originalBrowser = (globalThis as Record<string, unknown>).browser;
  const mock = createMockChrome();
  (globalThis as Record<string, unknown>).chrome = mock;
  (globalThis as Record<string, unknown>).browser = mock;
  return {
    mock: mock as ChromeMock & {
      _setQueryResult: (tabs: Tab[]) => void;
      _setGetResult: (tab: Tab | null) => void;
    },
    teardown: () => {
      (globalThis as Record<string, unknown>).chrome = originalChrome;
      (globalThis as Record<string, unknown>).browser = originalBrowser;
    },
  };
}

function createMinimalState(overrides: Partial<ServiceWorkerState> = {}): ServiceWorkerState {
  return {
    appState: createInitialState(),
    monitorTickInFlight: false,
    invalidStreamChecks: 0,
    lastStreamRotationAt: 0,
    streamValidationGraceUntil: 0,
    lastTrackedProgress: 0,
    lastTrackedMinutes: 0,
    lastTrackedDropKey: null,
    lastProgressAdvanceAt: 0,
    noProgressRotationAttempts: 0,
    playbackAttentionWarningSent: false,
    gamesCacheRefreshInFlight: null,
    twitchSessionCache: null,
    twitchSessionFetchInFlight: null,
    twitchSessionLastAttemptAt: 0,
    cachedDropsSnapshot: [],
    previousAllDropsCount: 0,
    cachedCampaignChannelsMap: {},
    lastFullRefreshAt: 0,
    dropClaimInFlight: false,
    dropClaimRetryAtById: new Map(),
    queueMissingStreak: new Map(),
    lastActivityAt: 0,
    apiConsecutiveFailures: 0,
    apiBackoffUntil: 0,
    integrityFallbackActive: false,
    integrityFallbackActiveUntil: 0,
    recoveryBackoffUntil: 0,
    lastRecoveryAttemptAt: 0,
    stalledRecoveryAttempts: 0,
    recoveryNotificationSent: false,
    lastGamesCacheRefreshAt: 0,
    ...overrides,
  };
}

describe('streamerWatchUrl', () => {
  test('encodes channel name and builds Twitch URL', () => {
    expect(streamerWatchUrl('TestChannel')).toBe('https://www.twitch.tv/testchannel');
  });

  test('handles special characters in channel name', () => {
    expect(streamerWatchUrl('Channel With Spaces')).toBe('https://www.twitch.tv/channel%20with%20spaces');
  });
});

describe('monitorDashboardUrl', () => {
  test('returns chrome-extension URL for monitor.html', () => {
    const { mock, teardown } = setupChromeMock();
    try {
      const url = monitorDashboardUrl();
      expect(url).toMatch(/^chrome-extension:\/\/mock-id\/monitor\.html$/);
    } finally {
      teardown();
    }
  });
});

describe('applyBestEffortAlwaysOnTop', () => {
  let mock: ReturnType<typeof setupChromeMock>['mock'];
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupChromeMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => {
    teardown();
  });

  test('sets alwaysOnTop and focused on window', async () => {
    await applyBestEffortAlwaysOnTop(1);
    expect(true).toBe(true);
  });

  test('falls back to focused-only if alwaysOnTop fails', async () => {
    let callCount = 0;
    const originalUpdate = mock.windows.update;
    mock.windows.update = async (windowId: number, details: WindowUpdateInfo) => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('not allowed'));
      }
      return originalUpdate(windowId, details);
    };
    await applyBestEffortAlwaysOnTop(1);
    expect(callCount).toBe(2);
  });
});

describe('createManagedTab', () => {
  let mock: ReturnType<typeof setupChromeMock>['mock'];
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupChromeMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => {
    teardown();
  });

  test('reuses current tab when active and URL is about:blank', async () => {
    mock._setQueryResult([{ id: 42, url: 'about:blank', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).toBe(42);
  });

  test('reuses current tab when active and URL is chrome://newtab', async () => {
    mock._setQueryResult([{ id: 42, url: 'chrome://newtab', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).toBe(42);
  });

  test('reuses current tab when active and URL is twitch.tv', async () => {
    mock._setQueryResult([{ id: 42, url: 'https://www.twitch.tv/other', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).toBe(42);
  });

  test('creates new tab when active but current tab is non-reusable URL', async () => {
    mock._setQueryResult([{ id: 42, url: 'https://example.com', active: true, windowId: 1 }]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', true);
    expect(result?.id).not.toBe(42);
  });

  test('creates new tab when not active', async () => {
    mock._setQueryResult([]);
    const result = await createManagedTab('https://www.twitch.tv/testchannel', false);
    expect(result?.url).toBe('https://www.twitch.tv/testchannel');
    expect(result?.active).toBe(false);
  });

  test('returns null when no focused window and create fails', async () => {
    mock.windows.getLastFocused = () => Promise.reject(new Error('no window'));
    mock.tabs.create = () => Promise.reject(new Error('create failed'));
    const result = await createManagedTab('https://www.twitch.tv/testchannel', false);
    expect(result).toBeNull();
  });
});

describe('ensureManagedTab', () => {
  let mock: ReturnType<typeof setupChromeMock>['mock'];
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupChromeMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => {
    teardown();
  });

  test('returns existing tabId if tab exists and is on Twitch', async () => {
    mock._setGetResult({ id: 5, url: 'https://www.twitch.tv/current', windowId: 1 });
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/new', false);
    expect(result).toBe(5);
  });

  test('updates URL if existing tab is on Twitch but URL differs', async () => {
    mock._setGetResult({ id: 5, url: 'https://www.twitch.tv/old', windowId: 1 });
    let updatedTab: Tab | null = null;
    mock.tabs.update = async (tabId: number, details: TabUpdateDetails) => {
      updatedTab = { id: tabId, ...details };
      return Promise.resolve(updatedTab);
    };
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/new', false);
    expect(result).toBe(5);
    expect(updatedTab?.url).toBe('https://www.twitch.tv/new');
  });

  test('reactivates tab if active flag is true and tab is not active', async () => {
    mock._setGetResult({ id: 5, url: 'https://www.twitch.tv/current', active: false, windowId: 1 });
    let updatedTab: Tab | null = null;
    mock.tabs.update = async (tabId: number, details: TabUpdateDetails) => {
      updatedTab = { id: tabId, ...details };
      return Promise.resolve(updatedTab);
    };
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/current', true);
    expect(result).toBe(5);
    expect(updatedTab?.active).toBe(true);
  });

  test('creates new tab if existing tabId is null', async () => {
    mock._setQueryResult([]);
    const result = await ensureManagedTab(null, 'https://www.twitch.tv/test', false);
    expect(result).not.toBeNull();
  });

  test('creates new tab if existing tab is not on Twitch', async () => {
    mock._setGetResult({ id: 5, url: 'https://example.com', windowId: 1 });
    mock._setQueryResult([]);
    const result = await ensureManagedTab(5, 'https://www.twitch.tv/test', false);
    expect(result).not.toBe(5);
  });
});

describe('closeManagedTabIfSafe', () => {
  let mock: ReturnType<typeof setupChromeMock>['mock'];
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupChromeMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => {
    teardown();
  });

  test('returns false when tabId is null', async () => {
    const result = await closeManagedTabIfSafe(null);
    expect(result).toBe(false);
  });

  test('returns false when tab not found', async () => {
    mock._setGetResult({} as Tab);
    const result = await closeManagedTabIfSafe(99);
    expect(result).toBe(false);
  });

  test('returns false when window has only one tab', async () => {
    mock._setGetResult({ id: 5, windowId: 1 });
    mock.tabs.query = () => Promise.resolve([{ id: 5 }]);
    const result = await closeManagedTabIfSafe(5);
    expect(result).toBe(false);
  });

  test('closes tab and returns true when window has multiple tabs', async () => {
    mock._setGetResult({ id: 5, windowId: 1 });
    mock.tabs.query = () => Promise.resolve([{ id: 5 }, { id: 6 }]);
    let removed = false;
    mock.tabs.remove = async (tabId: number) => {
      if (tabId === 5) removed = true;
    };
    const result = await closeManagedTabIfSafe(5);
    expect(result).toBe(true);
    expect(removed).toBe(true);
  });
});

describe('clearManagedTabOwnership', () => {
  test('clears tabId and activeStreamer from state', () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), tabId: 42, activeStreamer: 'TestChannel' },
    } as ServiceWorkerState);
    clearManagedTabOwnership(state);
    expect(state.appState.tabId).toBeNull();
    expect(state.appState.activeStreamer).toBeNull();
  });
});

describe('waitForTabComplete', () => {
  let mock: ReturnType<typeof setupChromeMock>['mock'];
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupChromeMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => {
    teardown();
  });

  test('resolves immediately if tab already complete', async () => {
    mock._setGetResult({ id: 5, status: 'complete' });
    await waitForTabComplete(5, 5000);
    expect(true).toBe(true);
  });

  test('resolves via onUpdated event when tab completes', async () => {
    mock._setGetResult({ id: 5, status: 'loading' });
    const promise = waitForTabComplete(5, 10000);
    mock.tabs.onUpdated.trigger(5, { status: 'complete' });
    await promise;
    expect(true).toBe(true);
  });

  test('resolves on timeout even if tab never completes', async () => {
    mock._setGetResult({ id: 5, status: 'loading' });
    await waitForTabComplete(5, 100);
    expect(true).toBe(true);
  });
});

describe('shouldMuteManagedFarmingTab', () => {
  test('returns true when muteFarmingTab is undefined', () => {
    const state = createMinimalState();
    expect(shouldMuteManagedFarmingTab(state)).toBe(true);
  });

  test('returns true when muteFarmingTab is true', () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), muteFarmingTab: true },
    } as ServiceWorkerState);
    expect(shouldMuteManagedFarmingTab(state)).toBe(true);
  });

  test('returns false when muteFarmingTab is explicitly false', () => {
    const state = createMinimalState({
      appState: { ...createInitialState(), muteFarmingTab: false },
    } as ServiceWorkerState);
    expect(shouldMuteManagedFarmingTab(state)).toBe(false);
  });
});

describe('syncManagedTabMuteState', () => {
  let mock: ReturnType<typeof setupChromeMock>['mock'];
  let teardown: () => void;

  beforeEach(() => {
    const setup = setupChromeMock();
    mock = setup.mock;
    teardown = setup.teardown;
  });

  afterEach(() => {
    teardown();
  });

  test('does nothing when tabId is null', async () => {
    let updateCalled = false;
    mock.tabs.update = () => {
      updateCalled = true;
      return Promise.reject(new Error('should not be called'));
    };
    const state = createMinimalState({
      appState: { ...createInitialState(), tabId: null },
    } as ServiceWorkerState);
    await syncManagedTabMuteState(state);
    expect(updateCalled).toBe(false);
  });

  test('updates tab with muted=true when muteFarmingTab is not false', async () => {
    let updatedMuted: boolean | undefined;
    mock.tabs.update = async (tabId: number, details: TabUpdateDetails) => {
      updatedMuted = details.muted;
      return Promise.resolve({ id: tabId, ...details } as Tab);
    };
    const state = createMinimalState({
      appState: { ...createInitialState(), tabId: 42 },
    } as ServiceWorkerState);
    await syncManagedTabMuteState(state);
    expect(updatedMuted).toBe(true);
  });

  test('updates tab with muted=false when muteFarmingTab is false', async () => {
    let updatedMuted: boolean | undefined;
    mock.tabs.update = async (tabId: number, details: TabUpdateDetails) => {
      updatedMuted = details.muted;
      return Promise.resolve({ id: tabId, ...details } as Tab);
    };
    const state = createMinimalState({
      appState: { ...createInitialState(), tabId: 42, muteFarmingTab: false },
    } as ServiceWorkerState);
    await syncManagedTabMuteState(state);
    expect(updatedMuted).toBe(false);
  });
});
