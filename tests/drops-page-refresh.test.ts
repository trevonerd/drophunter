import { describe, expect, test } from 'bun:test';
import { createDropsPageRefresher } from '../src/background/drops-page-refresh.ts';
import { createInitialState } from '../src/shared/utils.ts';

function createTabsApi() {
  let queryResult: Array<{ id?: number }> = [];
  const created: string[] = [];
  const createdActive: boolean[] = [];
  const activated: number[] = [];

  return {
    created,
    createdActive,
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
    async create(createData: { url: string; active: boolean }) {
      created.push(createData.url);
      createdActive.push(createData.active);
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

    expect(result).toEqual({
      success: true,
      opened: false,
      refreshed: true,
      gamesCount: 1,
      appState: state.appState,
    });
    expect(tabsApi.activated).toEqual([12]);
    expect(tabsApi.created).toEqual([]);
    expect(calls).toEqual(['activity', 'hydrate', 'save', 'broadcast', 'wait', 'refresh', 'save', 'broadcast']);
    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
  });

  test('waited refresh publishes progress before and after the refresh', async () => {
    const state = { appState: createInitialState() };
    state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
    const tabsApi = createTabsApi();
    const progressStates: boolean[] = [];
    const errorStates: Array<string | null | undefined> = [];
    const attemptStates: Array<number | null | undefined> = [];
    const completedStates: Array<number | null | undefined> = [];
    const campaignCountStates: Array<number | null | undefined> = [];
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {
        progressStates.push(state.appState.dropsPageRefreshInProgress);
        errorStates.push(state.appState.lastDropsPageRefreshError);
        attemptStates.push(state.appState.lastDropsPageRefreshAttemptAt);
        completedStates.push(state.appState.lastDropsPageRefreshCompletedAt);
        campaignCountStates.push(state.appState.lastDropsPageRefreshCampaignCount);
      },
      broadcastStateUpdate: () => {},
    });

    const beforeRefresh = Date.now();
    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(true);
    expect(result.appState?.dropsPageRefreshInProgress).toBe(false);
    expect(progressStates).toEqual([true, false]);
    expect(errorStates).toEqual([null, null]);
    expect(attemptStates[0]).toBeGreaterThanOrEqual(beforeRefresh);
    expect(attemptStates[1]).toBe(attemptStates[0]);
    expect(completedStates[0]).toBeNull();
    expect(completedStates[1]).toBeGreaterThanOrEqual(beforeRefresh);
    expect(campaignCountStates).toEqual([null, 1]);
  });

  test('clears a previous refresh error when a new refresh starts and succeeds', async () => {
    const state = { appState: createInitialState() };
    state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
    state.appState.lastDropsPageRefreshError = 'Previous failure';
    const tabsApi = createTabsApi();
    const savedErrors: Array<string | null | undefined> = [];
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => savedErrors.push(state.appState.lastDropsPageRefreshError),
      broadcastStateUpdate: () => {},
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(true);
    expect(savedErrors).toEqual([null, null]);
    expect(state.appState.lastDropsPageRefreshError).toBeNull();
  });

  test('waited refresh treats a signed-in zero-campaign result as unsuccessful sync', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {},
      broadcastStateUpdate: () => {},
      campaignRefreshAttempts: 1,
      campaignRefreshRetryDelayMs: 0,
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(false);
    expect(result.gamesCount).toBe(0);
    expect(result.error).toBe('No active Twitch Drops campaigns were detected.');
    expect(result.appState?.dropsPageRefreshInProgress).toBe(false);
  });

  test('keeps polling instead of failing when Twitch initially returns empty campaigns', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    let refreshAttempts = 0;
    const acceptAuthoritativeEmptyValues: Array<boolean | undefined> = [];
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async (options) => {
        refreshAttempts += 1;
        acceptAuthoritativeEmptyValues.push(options.acceptAuthoritativeEmpty);
        if (refreshAttempts === 3) {
          state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
          return state.appState.availableGames;
        }
        state.appState.availableGames = [];
        return [];
      },
      saveState: async () => {},
      broadcastStateUpdate: () => {},
      campaignRefreshAttempts: 3,
      campaignRefreshRetryDelayMs: 0,
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(true);
    expect(result.gamesCount).toBe(1);
    expect(result.error).toBeUndefined();
    expect(refreshAttempts).toBe(3);
    expect(acceptAuthoritativeEmptyValues).toEqual([false, false, true]);
    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
    expect(state.appState.lastDropsPageRefreshError).toBeNull();
  });

  test('treats a hidden refresh as successful when games are found even without a session', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => null,
      refreshGamesCacheFromHiddenFetch: async () => {
        state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
      },
      saveState: async () => {},
      broadcastStateUpdate: () => {},
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result).toEqual({
      success: true,
      opened: true,
      refreshed: true,
      gamesCount: 1,
      appState: state.appState,
    });
    expect(result.error).toBeUndefined();
  });

  test('marks the refresh unsuccessful when the games cache stays empty', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => {
        state.appState.availableGames = [];
      },
      saveState: async () => {},
      broadcastStateUpdate: () => {},
      campaignRefreshAttempts: 1,
      campaignRefreshRetryDelayMs: 0,
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(false);
    expect(result.gamesCount).toBe(0);
    expect(result.error).toBe('No active Twitch Drops campaigns were detected.');
    expect(result.appState?.dropsPageRefreshInProgress).toBe(false);
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
    expect(tabsApi.createdActive).toEqual([true]);
  });

  test('can open the Twitch Drops tab in the background without focusing it', async () => {
    const state = { appState: createInitialState() };
    state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
    const tabsApi = createTabsApi();
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {},
      broadcastStateUpdate: () => {},
    });

    const result = await refresher.openDropsPageAndRefresh({ active: false });

    expect(result.success).toBe(true);
    expect(tabsApi.created).toEqual(['https://www.twitch.tv/drops/campaigns']);
    expect(tabsApi.createdActive).toEqual([false]);
    expect(tabsApi.activated).toEqual([]);
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
      campaignRefreshAttempts: 1,
      campaignRefreshRetryDelayMs: 0,
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

  test('does not focus an existing Twitch Drops tab when active is false', async () => {
    const state = { appState: createInitialState() };
    state.appState.availableGames = [{ id: 'g1', name: 'Game', imageUrl: '' }];
    const tabsApi = createTabsApi();
    tabsApi.setQueryResult([{ id: 12 }]);
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => ({ oauthToken: 'token', deviceId: 'device', uuid: 'uuid' }),
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {},
      broadcastStateUpdate: () => {},
    });

    const result = await refresher.openDropsPageAndRefresh({ active: false });

    expect(result.success).toBe(true);
    expect(result.opened).toBe(false);
    expect(tabsApi.activated).toEqual([]);
    expect(tabsApi.created).toEqual([]);
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
    expect(state.appState.lastDropsPageRefreshError).toBe('Error: session unavailable');
    expect(state.appState.lastDropsPageRefreshCompletedAt).toBeNull();
    expect(state.appState.lastDropsPageRefreshCampaignCount).toBeNull();
  });

  test('waited refresh clears progress and returns a useful error when refresh fails', async () => {
    const state = { appState: createInitialState() };
    const tabsApi = createTabsApi();
    const refresher = createDropsPageRefresher(state, {
      tabsApi,
      trackActivity: async () => {},
      ensureStateHydratedForCache: async () => {},
      waitForTabComplete: async () => {},
      persistSessionFromDropsPage: async () => {
        throw new Error('session unavailable');
      },
      refreshGamesCacheFromHiddenFetch: async () => {},
      saveState: async () => {},
      broadcastStateUpdate: () => {},
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result).toEqual({
      success: false,
      opened: true,
      refreshed: false,
      gamesCount: 0,
      error: 'Error: session unavailable',
      appState: state.appState,
    });
    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
  });
});
