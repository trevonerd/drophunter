import { describe, expect, test } from 'bun:test';
import { createDropsPageRefresher } from '../src/background/drops-page-refresh.ts';
import { createInitialState } from '../src/shared/utils.ts';

function createTabsApi() {
  let queryResult: Array<{ id?: number }> = [];
  const created: string[] = [];
  const activated: number[] = [];

  return {
    created,
    activated,
    setQueryResult(tabs: Array<{ id?: number }>) {
      queryResult = tabs;
    },
    async query() {
      return queryResult;
    },
    async update(tabId: number) {
      activated.push(tabId);
      return { id: tabId };
    },
    async create(createData: { url: string }) {
      created.push(createData.url);
      return { id: 42 };
    },
  };
}

describe('drops page refresher', () => {
  test('reuses an existing Twitch Drops tab and refreshes campaign cache', async () => {
    const state = { appState: { ...createInitialState(), availableGames: [{ id: 'g1', name: 'Game', imageUrl: '' }] } };
    const tabsApi = createTabsApi();
    tabsApi.setQueryResult([{ id: 12 }]);
    const calls: string[] = [];
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => calls.push('activity'),
      ensureStateHydratedForCache: async () => calls.push('hydrate'),
      waitForTabComplete: async () => calls.push('wait'),
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => calls.push('refresh'),
      saveState: async () => calls.push('save'),
      broadcastStateUpdate: () => calls.push('broadcast'),
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result).toEqual({ success: true, opened: false, refreshed: true, gamesCount: 1 });
    expect(tabsApi.activated).toEqual([12]);
    expect(tabsApi.created).toEqual([]);
    expect(calls).toEqual(['activity', 'hydrate', 'wait', 'refresh', 'save', 'broadcast']);
  });

  test('shares concurrent refresh work to avoid duplicate Twitch tabs', async () => {
    const state = { appState: createInitialState() };
    state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
    const tabsApi = createTabsApi();
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => null,
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {},
      broadcastStateUpdate: () => {},
    });

    const [first, second] = await Promise.all([
      refresher.openDropsPageAndRefresh(),
      refresher.openDropsPageAndRefresh(),
    ]);

    expect(first).toBe(second);
    expect(tabsApi.created).toEqual(['https://www.twitch.tv/drops/campaigns']);
  });

  test('can return after opening the tab while refresh continues in background', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    const calls: string[] = [];
    let finishTabLoad: () => void = () => {};
    const tabLoadStarted = new Promise<void>((resolve) => {
      finishTabLoad = resolve;
    });
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => calls.push('activity'),
      ensureStateHydratedForCache: async () => calls.push('hydrate'),
      waitForTabComplete: async () => {
        calls.push('wait');
        await tabLoadStarted;
      },
      persistSessionFromDropsPage: async () => {
        calls.push('session');
        return { oauthToken: 'token', deviceId: 'device', uuid: 'uuid' };
      },
      refreshGamesCacheFromHiddenFetch: async () => calls.push('refresh'),
      saveState: async () => calls.push('save'),
      broadcastStateUpdate: () => calls.push('broadcast'),
    });

    const result = await refresher.openDropsPageAndRefresh({ waitForRefresh: false });

    expect(result).toEqual({ success: true, opened: true, refreshed: false, gamesCount: 0 });
    expect(state.appState.dropsPageRefreshInProgress).toBe(true);
    expect(tabsApi.created).toEqual(['https://www.twitch.tv/drops/campaigns']);
    expect(calls).toEqual(['activity', 'hydrate', 'save', 'broadcast', 'wait']);

    finishTabLoad();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
    expect(calls).toEqual([
      'activity',
      'hydrate',
      'save',
      'broadcast',
      'wait',
      'session',
      'refresh',
      'save',
      'broadcast',
    ]);
  });

  test('clears background refresh progress when the async refresh fails', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    let finishTabLoad: () => void = () => {};
    const tabLoadStarted = new Promise<void>((resolve) => {
      finishTabLoad = resolve;
    });
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {
        await tabLoadStarted;
      },
      persistSessionFromDropsPage: async () => {
        throw new Error('session unavailable');
      },
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {},
      broadcastStateUpdate: () => {},
    });

    const result = await refresher.openDropsPageAndRefresh({ waitForRefresh: false });

    expect(result.refreshed).toBe(false);
    expect(state.appState.dropsPageRefreshInProgress).toBe(true);

    finishTabLoad();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
  });
});
