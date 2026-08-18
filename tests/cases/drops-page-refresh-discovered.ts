import { expect, test } from 'bun:test';
import {
  createDropsPageState,
  createTabsApi,
  createTestRefresher,
  setDiscoveredGame,
} from '../fixtures/drops-page-refresh.ts';

export function registerDiscoveredDropsPageRefreshCases() {
  test('reuses an existing Twitch Drops tab and refreshes campaign cache', async () => {
    const state = createDropsPageState();
    setDiscoveredGame(state);
    const tabsApi = createTabsApi();
    tabsApi.setQueryResult([{ id: 12 }]);
    const calls: string[] = [];
    const refresher = createTestRefresher(state, tabsApi, {
      trackActivity: async () => calls.push('activity'),
      ensureStateHydratedForCache: async () => calls.push('hydrate'),
      waitForTabComplete: async () => calls.push('wait'),
      refreshGamesCacheFromHiddenFetch: async () => {
        calls.push('refresh');
        return { kind: 'refreshed', games: state.appState.availableGames };
      },
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
    expect(calls).toEqual([
      'activity',
      'hydrate',
      'save',
      'broadcast',
      'wait',
      'refresh',
      'save',
      'broadcast',
    ]);
    expect(state.appState.dropsPageRefreshInProgress).toBe(false);
  });

  test('waited refresh publishes progress before and after the refresh', async () => {
    const state = createDropsPageState();
    setDiscoveredGame(state);
    const progressStates: boolean[] = [];
    const errorStates: Array<string | null | undefined> = [];
    const attemptStates: Array<number | null | undefined> = [];
    const completedStates: Array<number | null | undefined> = [];
    const campaignCountStates: Array<number | null | undefined> = [];
    const refresher = createTestRefresher(state, createTabsApi(), {
      saveState: async () => {
        progressStates.push(state.appState.dropsPageRefreshInProgress);
        errorStates.push(state.appState.lastDropsPageRefreshError);
        attemptStates.push(state.appState.lastDropsPageRefreshAttemptAt);
        completedStates.push(state.appState.lastDropsPageRefreshCompletedAt);
        campaignCountStates.push(state.appState.lastDropsPageRefreshCampaignCount);
      },
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
    const state = createDropsPageState();
    setDiscoveredGame(state);
    state.appState.lastDropsPageRefreshError = 'Previous failure';
    const savedErrors: Array<string | null | undefined> = [];
    const refresher = createTestRefresher(state, createTabsApi(), {
      saveState: async () => savedErrors.push(state.appState.lastDropsPageRefreshError),
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(true);
    expect(savedErrors).toEqual([null, null]);
    expect(state.appState.lastDropsPageRefreshError).toBeNull();
  });

  test('keeps polling instead of failing when Twitch initially returns empty campaigns', async () => {
    const state = createDropsPageState();
    let refreshAttempts = 0;
    const acceptAuthoritativeEmptyValues: Array<boolean | undefined> = [];
    const refresher = createTestRefresher(state, createTabsApi(), {
      refreshGamesCacheFromHiddenFetch: async (options) => {
        refreshAttempts += 1;
        acceptAuthoritativeEmptyValues.push(options.acceptAuthoritativeEmpty);
        if (refreshAttempts === 3) {
          setDiscoveredGame(state);
          return { kind: 'refreshed', games: state.appState.availableGames };
        }
        state.appState.availableGames = [];
        return { kind: 'refreshed', games: [] };
      },
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
    const state = createDropsPageState();
    const refresher = createTestRefresher(state, createTabsApi(), {
      persistSessionFromDropsPage: async () => null,
      refreshGamesCacheFromHiddenFetch: async () => {
        setDiscoveredGame(state);
        return { kind: 'refreshed', games: state.appState.availableGames };
      },
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

  test('shares concurrent refresh work to avoid duplicate Twitch tabs', async () => {
    const state = createDropsPageState();
    setDiscoveredGame(state);
    const tabsApi = createTabsApi();
    const refresher = createTestRefresher(state, tabsApi, { persistSessionFromDropsPage: async () => null });

    const [first, second] = await Promise.all([
      refresher.openDropsPageAndRefresh(),
      refresher.openDropsPageAndRefresh(),
    ]);

    expect(first).toBe(second);
    expect(tabsApi.created).toEqual(['https://www.twitch.tv/drops/campaigns']);
    expect(tabsApi.createdActive).toEqual([true]);
  });

  test('can open the Twitch Drops tab in the background without focusing it', async () => {
    const state = createDropsPageState();
    setDiscoveredGame(state);
    const tabsApi = createTabsApi();

    const result = await createTestRefresher(state, tabsApi).openDropsPageAndRefresh({ active: false });

    expect(result.success).toBe(true);
    expect(tabsApi.created).toEqual(['https://www.twitch.tv/drops/campaigns']);
    expect(tabsApi.createdActive).toEqual([false]);
    expect(tabsApi.activated).toEqual([]);
  });

  test('does not focus an existing Twitch Drops tab when active is false', async () => {
    const state = createDropsPageState();
    setDiscoveredGame(state);
    const tabsApi = createTabsApi();
    tabsApi.setQueryResult([{ id: 12 }]);

    const result = await createTestRefresher(state, tabsApi).openDropsPageAndRefresh({ active: false });

    expect(result.success).toBe(true);
    expect(result.opened).toBe(false);
    expect(tabsApi.activated).toEqual([]);
    expect(tabsApi.created).toEqual([]);
  });
}
