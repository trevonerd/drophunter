import { expect, spyOn, test } from 'bun:test';
import { TWITCH_DROPS_PAGE_URL } from '../src/background/constants.ts';
import { createDropsPageRefresher } from '../src/background/drops-page-refresh.ts';
import type { DropsPageRefreshOptions } from '../src/background/drops-page-tab-lifecycle.ts';
import { createInitialState } from '../src/shared/utils.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { installManagedWatchPages } from './support/managed-watch-pages.ts';

function fixture() {
  const mocks = setupChromeMocks();
  const tabs = installManagedWatchPages(mocks);
  tabs.add('https://example.com', 1);
  const state = { appState: createInitialState() };
  state.appState.twitchSessionDetected = true;
  const loaded = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let session = true;
  const options: DropsPageRefreshOptions = {
    tabsApi: {
      ...mocks.chrome.tabs,
      query: async (query: { url: string[] } | { windowId: number }) =>
        'url' in query
          ? [...tabs.pages.values()].filter((tab) => tab.url === TWITCH_DROPS_PAGE_URL)
          : mocks.chrome.tabs.query(query),
      create: async (properties) => {
        const tab = await mocks.chrome.tabs.create(properties);
        const page = tabs.pages.get(tab.id ?? -1);
        if (page) page.active = properties.active;
        return tab;
      },
    },
    trackActivity: async () => {},
    ensureStateHydratedForCache: async () => {},
    waitForTabComplete: async () => {
      entered.resolve();
      await loaded.promise;
    },
    persistSessionFromDropsPage: async () => (session ? {} : null),
    refreshGamesCacheFromHiddenFetch: async () =>
      session ? { kind: 'refreshed', games: [] } : { kind: 'unavailable', games: [] },
    campaignRefreshAttempts: 1,
    saveState: async () => {},
    broadcastStateUpdate: () => {},
  };
  const refresher = createDropsPageRefresher(state, options);
  return {
    mocks,
    tabs,
    refresher,
    options,
    loaded,
    entered,
    setSession: (value: boolean) => {
      session = value;
    },
  };
}

test('closes only the automatically created Drops tab after refresh finishes', async () => {
  const f = fixture();
  try {
    const pending = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
    await f.entered.promise;
    expect(f.tabs.removed).toEqual([]);
    f.loaded.resolve();
    expect((await pending).success).toBe(true);
    expect(f.tabs.removed).toEqual(f.tabs.created);
    expect(f.tabs.pages.has(1)).toBe(true);
  } finally {
    f.mocks.teardown();
  }
});

test('a cancelled refresh leaves the shared automatic page until its final consumer finishes', async () => {
  const f = fixture();
  let current = true;
  const replacementEntered = Promise.withResolvers<void>();
  const replacementLoaded = Promise.withResolvers<void>();
  try {
    const first = f.refresher.openDropsPageAndRefresh({
      active: false,
      closeAfterRefresh: true,
      isCurrent: () => current,
    });
    await f.entered.promise;
    current = false;
    f.options.waitForTabComplete = async () => {
      replacementEntered.resolve();
      await replacementLoaded.promise;
    };
    const second = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
    await replacementEntered.promise;
    f.loaded.resolve();
    expect((await first).success).toBe(false);
    expect(f.tabs.removed).toEqual([]);
    replacementLoaded.resolve();
    expect((await second).success).toBe(true);
    expect(f.tabs.created).toHaveLength(1);
    expect(f.tabs.removed).toEqual(f.tabs.created);
  } finally {
    f.mocks.teardown();
  }
});

test('a timed out automatic consumer releases its created page after pending work finishes', async () => {
  const f = fixture();
  const startedAt = Date.now();
  const now = spyOn(Date, 'now').mockReturnValue(startedAt);
  try {
    const pending = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
    await f.entered.promise;
    now.mockReturnValue(startedAt + 61_000);
    expect(f.tabs.removed).toEqual([]);
    f.loaded.resolve();
    expect((await pending).success).toBe(false);
    expect(f.tabs.removed).toEqual(f.tabs.created);
  } finally {
    now.mockRestore();
    f.mocks.teardown();
  }
});

test('explicit Open Drops during hydration retains and activates the eventual page', async () => {
  const f = fixture();
  const hydrating = Promise.withResolvers<void>();
  const hydrated = Promise.withResolvers<void>();
  f.options.ensureStateHydratedForCache = async () => {
    hydrating.resolve();
    await hydrated.promise;
  };
  try {
    const automatic = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
    await hydrating.promise;
    expect(f.refresher.openDropsPageAndRefresh()).toBe(automatic);
    hydrated.resolve();
    await f.entered.promise;
    const tab = [...f.tabs.pages.values()].find((page) => page.url === TWITCH_DROPS_PAGE_URL);
    expect(tab?.active).toBe(true);
    f.loaded.resolve();
    await automatic;
    expect(f.tabs.removed).toEqual([]);
  } finally {
    f.mocks.teardown();
  }
});

test('moving the automatic Drops page to a different sole-tab window prevents cleanup', async () => {
  const f = fixture();
  const api = f.options.tabsApi;
  if (!api?.get) throw new Error('Missing tab getter');
  const get = api.get.bind(api);
  let checks = 0;
  api.get = async (id) => {
    const tab = await get(id);
    if (++checks === 2) return { ...tab, windowId: 99 };
    return { ...tab };
  };
  try {
    const pending = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
    await f.entered.promise;
    f.loaded.resolve();
    await pending;
    expect(checks).toBe(2);
    expect(f.tabs.removed).toEqual([]);
  } finally {
    f.mocks.teardown();
  }
});

test('cleanup waits for a borrower whose Drops tab query is still pending', async () => {
  const f = fixture();
  const api = f.options.tabsApi;
  if (!api?.get) throw new Error('Missing tab getter');
  const get = api.get.bind(api);
  const query = api.query.bind(api);
  const cleanupEntered = Promise.withResolvers<void>();
  const cleanupRelease = Promise.withResolvers<void>();
  const queryEntered = Promise.withResolvers<void>();
  const queryRelease = Promise.withResolvers<void>();
  let current = true;
  let reads = 0;
  api.get = async (id) => {
    if (++reads === 1) {
      cleanupEntered.resolve();
      await cleanupRelease.promise;
    }
    return get(id);
  };
  try {
    const first = f.refresher.openDropsPageAndRefresh({
      active: false,
      closeAfterRefresh: true,
      isCurrent: () => current,
    });
    await f.entered.promise;
    current = false;
    f.loaded.resolve();
    await cleanupEntered.promise;
    api.query = async (info) => {
      const tabs = await query(info);
      if ('url' in info) {
        queryEntered.resolve();
        await queryRelease.promise;
      }
      return tabs;
    };
    const second = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
    await queryEntered.promise;
    cleanupRelease.resolve();
    await first;
    expect(f.tabs.removed).toEqual([]);
    queryRelease.resolve();
    expect((await second).success).toBe(true);
    expect(f.tabs.created).toHaveLength(1);
    expect(f.tabs.removed).toEqual(f.tabs.created);
  } finally {
    cleanupRelease.resolve();
    queryRelease.resolve();
    f.mocks.teardown();
  }
});

test.each(['existing', 'manual', 'navigated', 'only-tab', 'sign-in'] as const)(
  'preserves a Drops page needed for %s',
  async (reason) => {
    const f = fixture();
    try {
      if (reason === 'existing') f.tabs.add(TWITCH_DROPS_PAGE_URL);
      if (reason === 'only-tab') f.tabs.pages.delete(1);
      if (reason === 'sign-in') f.setSession(false);
      const pending = f.refresher.openDropsPageAndRefresh({ active: false, closeAfterRefresh: true });
      await f.entered.promise;
      if (reason === 'manual') expect(f.refresher.openDropsPageAndRefresh()).toBe(pending);
      if (reason === 'navigated') {
        const page = [...f.tabs.pages.values()].find((tab) => tab.url === TWITCH_DROPS_PAGE_URL);
        if (page) page.url = 'https://www.twitch.tv/user_channel';
      }
      f.loaded.resolve();
      await pending;
      expect(f.tabs.removed).toEqual([]);
    } finally {
      f.mocks.teardown();
    }
  },
);
