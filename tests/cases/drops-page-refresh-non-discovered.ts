import { expect, test } from 'bun:test';
import { createDropsPageState, createTabsApi, createTestRefresher } from '../fixtures/drops-page-refresh.ts';

export function registerNonDiscoveredDropsPageRefreshCases() {
  test('waited refresh treats a signed-in authoritative zero-campaign result as a successful sync', async () => {
    const state = createDropsPageState();
    const refresher = createTestRefresher(state, createTabsApi(), {
      campaignRefreshAttempts: 1,
      campaignRefreshRetryDelayMs: 0,
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(true);
    expect(result.gamesCount).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.appState?.dropsPageRefreshInProgress).toBe(false);
    expect(result.appState?.lastDropsPageRefreshCampaignCount).toBe(0);
    expect(result.appState?.lastDropsPageRefreshError).toBeNull();
  });

  test('reports a temporarily unavailable snapshot without claiming that campaigns are empty', async () => {
    const state = createDropsPageState();
    state.appState.availableGames = [{ id: 'cached-game', name: 'Saved Game', imageUrl: '' }];
    const refresher = createTestRefresher(state, createTabsApi(), {
      refreshGamesCacheFromHiddenFetch: async () => ({
        kind: 'unavailable',
        games: state.appState.availableGames,
      }),
      campaignRefreshAttempts: 2,
      campaignRefreshRetryDelayMs: 0,
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(false);
    expect(result.gamesCount).toBe(1);
    expect(result.error).toBe('Twitch campaign data is temporarily unavailable. Try again.');
    expect(result.appState?.availableGames).toHaveLength(1);
    expect(result.appState?.lastDropsPageRefreshCampaignCount).toBeNull();
  });

  test('marks the refresh unsuccessful when a fresh snapshot is unavailable', async () => {
    const state = createDropsPageState();
    const refresher = createTestRefresher(state, createTabsApi(), {
      refreshGamesCacheFromHiddenFetch: async () => ({ kind: 'unavailable', games: [] }),
      campaignRefreshAttempts: 1,
      campaignRefreshRetryDelayMs: 0,
    });

    const result = await refresher.openDropsPageAndRefresh();

    expect(result.success).toBe(false);
    expect(result.gamesCount).toBe(0);
    expect(result.error).toBe('Twitch campaign data is temporarily unavailable. Try again.');
    expect(result.appState?.dropsPageRefreshInProgress).toBe(false);
  });

  test('can return after opening the tab while refresh continues in background', async () => {
    const state = createDropsPageState();
    const tabsApi = createTabsApi();
    const calls: string[] = [];
    let finishTabLoad: () => void = () => {};
    const tabLoadStarted = new Promise<void>((resolve) => {
      finishTabLoad = resolve;
    });
    const refresher = createTestRefresher(state, tabsApi, {
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
      refreshGamesCacheFromHiddenFetch: async () => {
        calls.push('refresh');
        return { kind: 'refreshed', games: [] };
      },
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

  test('clears background refresh progress when the async refresh fails', async () => {
    const state = createDropsPageState();
    let finishTabLoad: () => void = () => {};
    const tabLoadStarted = new Promise<void>((resolve) => {
      finishTabLoad = resolve;
    });
    const refresher = createTestRefresher(state, createTabsApi(), {
      waitForTabComplete: async () => tabLoadStarted,
      persistSessionFromDropsPage: async () => {
        throw new Error('session unavailable');
      },
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
    const state = createDropsPageState();
    const refresher = createTestRefresher(state, createTabsApi(), {
      persistSessionFromDropsPage: async () => {
        throw new Error('session unavailable');
      },
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
}
