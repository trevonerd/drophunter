import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  createDropsPageState,
  createTabsApi,
  createTestRefresher,
  setDiscoveredGame,
} from './fixtures/drops-page-refresh.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

let mocks: ReturnType<typeof setupChromeMocks>;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());

test('opening Drops creates a missing page in the foreground', async () => {
  const tabs = createTabsApi();
  tabs.create = async (properties) => {
    tabs.created.push(properties.url);
    tabs.createdActive.push(properties.active);
    return { id: 42, windowId: 2 };
  };
  const focused: number[] = [];
  mocks.chrome.windows.update = async (windowId) => {
    focused.push(windowId);
    return null;
  };
  const state = createDropsPageState();
  setDiscoveredGame(state);
  const result = await createTestRefresher(state, tabs).openDropsPageAndRefresh();
  expect(result.success).toBe(true);
  expect(tabs.created).toHaveLength(1);
  expect(tabs.createdActive).toEqual([true]);
  expect(focused).toEqual([2]);
});

test.each([1, 2])(
  'opening Drops brings its existing browser window %s to the foreground',
  async (windowId) => {
    const tabs = createTabsApi();
    tabs.setQueryHandler(() => [{ id: 7, windowId }]);
    const focused: number[] = [];
    mocks.chrome.windows.update = async (windowId, properties) => {
      if (properties.focused) focused.push(windowId);
      return null;
    };
    const state = createDropsPageState();
    setDiscoveredGame(state);
    const result = await createTestRefresher(state, tabs).openDropsPageAndRefresh();
    expect(result.success).toBe(true);
    expect(tabs.activated).toEqual([7]);
    expect(focused).toEqual([windowId]);
    expect(tabs.created).toEqual([]);
  },
);

test('a manual borrower focuses and retains an automatic Drops page without duplicating its refresh', async () => {
  const tabs = createTabsApi();
  tabs.setQueryHandler(() => [{ id: 7, windowId: 2 }]);
  const state = createDropsPageState();
  setDiscoveredGame(state);
  const entered = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  const focused: number[] = [];
  mocks.chrome.windows.update = async (windowId) => {
    focused.push(windowId);
    return null;
  };
  let refreshes = 0;
  const refresher = createTestRefresher(state, tabs, {
    waitForTabComplete: async () => {
      entered.resolve();
      await loaded.promise;
    },
    refreshGamesCacheFromHiddenFetch: async () => {
      refreshes++;
      return { kind: 'refreshed', games: state.appState.availableGames };
    },
  });
  const automatic = refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
  await entered.promise;
  expect(focused).toEqual([]);
  const manual = refresher.openDropsPageAndRefresh();
  loaded.resolve();
  await Promise.all([automatic, manual]);
  expect(focused).toEqual([2]);
  expect(tabs.activated).toEqual([7]);
  expect(refreshes).toBe(1);
});

test.each(['tab', 'window'] as const)('manual opening reports a failed %s activation', async (failure) => {
  const tabs = createTabsApi();
  tabs.setQueryHandler(() => [{ id: 7, windowId: 2 }]);
  if (failure === 'tab')
    tabs.update = async () => {
      throw new Error('Unable to activate Drops tab.');
    };
  else
    mocks.chrome.windows.update = async () => {
      throw new Error('Unable to focus Drops window.');
    };
  await expect(createTestRefresher(createDropsPageState(), tabs).openDropsPageAndRefresh()).rejects.toThrow(
    failure === 'tab' ? 'Unable to activate Drops tab.' : 'Unable to focus Drops window.',
  );
});

test('a manual borrower receives a window activation error even when the shared refresh succeeds', async () => {
  const tabs = createTabsApi();
  tabs.setQueryHandler(() => [{ id: 7, windowId: 2 }]);
  const state = createDropsPageState();
  setDiscoveredGame(state);
  const entered = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  mocks.chrome.windows.update = async () => {
    throw new Error('Unable to focus Drops window.');
  };
  const refresher = createTestRefresher(state, tabs, {
    waitForTabComplete: async () => {
      entered.resolve();
      await loaded.promise;
    },
  });
  const automatic = refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
  await entered.promise;
  const failed = expect(refresher.openDropsPageAndRefresh()).rejects.toThrow('Unable to focus Drops window.');
  loaded.resolve();
  await failed;
  expect((await automatic).success).toBe(true);
});

test('a foreground fast open shares an automatic page whose native creation is still pending', async () => {
  const startedAt = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(startedAt);
  const tabs = createTabsApi();
  const creating = Promise.withResolvers<void>();
  const created = Promise.withResolvers<{ id: number; windowId: number }>();
  let creations = 0;
  tabs.create = async () => {
    creations++;
    creating.resolve();
    return creations === 1 ? created.promise : { id: 43, windowId: 2 };
  };
  const focused: number[] = [];
  mocks.chrome.windows.update = async (windowId) => {
    focused.push(windowId);
    return null;
  };
  const state = createDropsPageState();
  setDiscoveredGame(state);
  const refresher = createTestRefresher(state, tabs);
  let current = true;
  const automatic = refresher.openDropsPageAndRefresh({
    active: false,
    closeAfterRefresh: true,
    isCurrent: () => current,
  });
  await creating.promise;
  clock.mockReturnValue(startedAt + 74_000);
  const manual = refresher.openDropsPageAndRefresh({ active: true, waitForRefresh: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    expect(creations).toBe(1);
  } finally {
    current = false;
    clock.mockReturnValue(startedAt + 76_000);
    created.resolve({ id: 42, windowId: 2 });
    await Promise.all([automatic, manual]);
    clock.mockRestore();
  }
  expect(focused).toEqual([2]);
});

test('an explicit opening can retry failed focus while the shared refresh remains pending', async () => {
  const tabs = createTabsApi();
  tabs.setQueryHandler(() => [{ id: 7, windowId: 2 }]);
  const state = createDropsPageState();
  setDiscoveredGame(state);
  const entered = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  let focusAttempts = 0;
  mocks.chrome.windows.update = async () => {
    if (++focusAttempts === 1) throw new Error('Unable to focus Drops window.');
    return null;
  };
  const refresher = createTestRefresher(state, tabs, {
    waitForTabComplete: async () => {
      entered.resolve();
      await loaded.promise;
    },
  });
  const automatic = refresher.openDropsPageAndRefresh({ active: false });
  await entered.promise;
  try {
    await expect(refresher.openDropsPageAndRefresh({ waitForRefresh: false })).rejects.toThrow(
      'Unable to focus',
    );
    expect((await refresher.openDropsPageAndRefresh({ waitForRefresh: false })).success).toBe(true);
    expect(focusAttempts).toBe(2);
    expect(tabs.created).toEqual([]);
  } finally {
    loaded.resolve();
    await automatic;
  }
});

test('an explicit borrower authorizes creating the page while an automatic existing-only lookup is pending', async () => {
  const tabs = createTabsApi();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  tabs.query = async () => {
    entered.resolve();
    await release.promise;
    return [];
  };
  const state = createDropsPageState();
  setDiscoveredGame(state);
  const refresher = createTestRefresher(state, tabs);
  const automatic = refresher.openDropsPageAndRefresh({ active: false, openIfMissing: false });
  await entered.promise;
  const manual = refresher.openDropsPageAndRefresh({ waitForRefresh: false });
  release.resolve();
  const [synced, opened] = await Promise.all([automatic, manual]);
  expect(opened.success).toBe(true);
  expect(synced.success).toBe(true);
  expect(tabs.created).toHaveLength(1);
  expect(tabs.activated).toEqual([42]);
});
