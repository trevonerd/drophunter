import { expect, test } from 'bun:test';
import type { AppState, TwitchGame } from '../../src/types/index.ts';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { enqueueDropsSnapshot, resetFetchScenarios } from '../helpers/service-worker-fetch.ts';
import {
  addGameToQueue,
  chromeMocks,
  dispatchMessage,
  getAppStateFromStorage,
  syncTestSession,
  waitForAppState,
} from '../helpers/service-worker-harness.ts';

export function registerRefreshLaunchCases() {
  test('OPEN_DROPS_PAGE_AND_REFRESH opens Twitch, extracts session, and refreshes campaigns', async () => {
    const chrome = chromeMocks.chrome;
    let createCalls = 0;
    let executeScriptCalls = 0;
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url }) => {
      createCalls += 1;
      return { id: 321, windowId: 1, url, status: 'complete' };
    };
    chrome.tabs.get = async (tabId) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chrome.scripting.executeScript = async () => {
      executeScriptCalls += 1;
      return [];
    };
    chrome.tabs.sendMessage = async (_tabId, message) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-open-page', currentMinutes: 0 }]);

    const beforeRefresh = Date.now();
    const response = (await dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' })) as {
      success?: boolean;
      gamesCount?: number;
      opened?: boolean;
      appState?: AppState;
    };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(true);
    expect(response.gamesCount).toBe(1);
    expect(response.appState?.dropsPageRefreshInProgress).toBe(false);
    expect(response.appState?.lastSuccessfulRefreshAt).toBeGreaterThanOrEqual(beforeRefresh);
    expect(createCalls).toBe(1);
    expect(executeScriptCalls).toBe(1);
    const state = getAppStateFromStorage();
    expect(state.availableGames).toHaveLength(1);
    expect(state.availableGames[0].campaignId).toBe(demoGame.campaignId);
    expect(state.lastSuccessfulRefreshAt).toBe(response.appState?.lastSuccessfulRefreshAt);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH can refresh through an inactive Twitch tab', async () => {
    const chrome = chromeMocks.chrome;
    const createdActiveValues: boolean[] = [];
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url, active }) => {
      createdActiveValues.push(Boolean(active));
      return { id: 432, windowId: 1, url, active: Boolean(active), status: 'complete' };
    };
    chrome.tabs.get = async (tabId) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chrome.tabs.sendMessage = async (_tabId, message) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-inactive-open-page', currentMinutes: 0 }]);

    const response = (await dispatchMessage({
      type: 'OPEN_DROPS_PAGE_AND_REFRESH',
      payload: { waitForRefresh: true, active: false },
    })) as { success?: boolean; gamesCount?: number; opened?: boolean };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(true);
    expect(response.gamesCount).toBe(1);
    expect(createdActiveValues).toEqual([false]);
    expect(getAppStateFromStorage().dropsPageRefreshInProgress).toBe(false);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH foreground async launch later populates campaign storage', async () => {
    const chrome = chromeMocks.chrome;
    const asyncGame: TwitchGame = {
      id: 'async-game',
      name: 'Async Game',
      imageUrl: 'https://example.com/async.png',
      campaignId: 'async-campaign',
      categorySlug: 'async-game',
    };
    const createdActiveValues: boolean[] = [];
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url, active }) => {
      createdActiveValues.push(Boolean(active));
      return { id: 543, windowId: 1, url, active: Boolean(active), status: 'complete' };
    };
    chrome.tabs.get = async (tabId) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chrome.tabs.sendMessage = async (_tabId, message) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([{ game: asyncGame, dropId: 'drop-async-launch', currentMinutes: 0 }]);

    const response = (await dispatchMessage({
      type: 'OPEN_DROPS_PAGE_AND_REFRESH',
      payload: { waitForRefresh: false, active: true },
    })) as { success?: boolean; opened?: boolean; refreshed?: boolean };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(true);
    expect(response.refreshed).toBe(false);
    expect(createdActiveValues).toEqual([true]);
    expect(getAppStateFromStorage().dropsPageRefreshInProgress).toBe(true);

    const refreshedState = await waitForAppState(
      (state) => state.availableGames.some((game) => game.campaignId === asyncGame.campaignId),
      'async Drops page refresh did not populate campaigns',
    );
    expect(refreshedState.dropsPageRefreshInProgress).toBe(false);
    expect(refreshedState.lastDropsPageRefreshError).toBeNull();
    expect(typeof refreshedState.lastDropsPageRefreshCompletedAt).toBe('number');
    expect(refreshedState.lastDropsPageRefreshCampaignCount).toBe(1);
    const completedAt = refreshedState.lastDropsPageRefreshCompletedAt as number;
    const seenResponse = (await dispatchMessage({
      type: 'MARK_DROPS_REFRESH_NOTICE_SEEN',
      payload: { seenAt: completedAt },
    })) as { success?: boolean; seenAt?: number | null };

    expect(seenResponse.success).toBe(true);
    expect(seenResponse.seenAt).toBe(completedAt);
    expect(getAppStateFromStorage().lastDropsPageRefreshNoticeSeenAt).toBe(completedAt);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH clears stale campaign state after a successful empty refresh', async () => {
    const chrome = chromeMocks.chrome;
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-before-empty-refresh', currentMinutes: 20 }]);
    await syncTestSession();
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-before-empty-refresh', currentMinutes: 20 }]);
    await dispatchMessage({ type: 'UPDATE_GAMES', payload: [demoGame] });
    await dispatchMessage({ type: 'SET_SELECTED_GAME', payload: { game: demoGame } });
    await addGameToQueue(demoGame);

    const before = getAppStateFromStorage();
    expect(before.availableGames).toHaveLength(1);
    expect(before.selectedGame?.campaignId).toBe(demoGame.campaignId);
    expect(before.pendingDrops.length).toBeGreaterThan(0);
    expect(before.queue).toHaveLength(1);

    resetFetchScenarios();
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url, active }) => ({
      id: 765,
      windowId: 1,
      url,
      active: Boolean(active),
      status: 'complete',
    });
    chrome.tabs.get = async (tabId) => ({
      id: tabId,
      windowId: 1,
      url: 'https://www.twitch.tv/drops/campaigns',
      status: 'complete',
    });
    chrome.tabs.sendMessage = async (_tabId, message) => {
      if (message.type === 'GET_TWITCH_SESSION') {
        return {
          success: true,
          session: {
            oauthToken: 'oauth-token-with-valid-length-1234567890',
            userId: '123456',
            deviceId: 'device-12345678',
            uuid: 'uuid-1',
          },
        };
      }
      return { success: false };
    };
    enqueueDropsSnapshot([]);

    const realDateNow = Date.now;
    let now = realDateNow();
    Date.now = () => {
      now += 61_000;
      return now;
    };
    let response: { success?: boolean; gamesCount?: number; error?: string; appState?: AppState };
    try {
      response = (await dispatchMessage({
        type: 'OPEN_DROPS_PAGE_AND_REFRESH',
        payload: { waitForRefresh: true, active: false },
      })) as { success?: boolean; gamesCount?: number; error?: string; appState?: AppState };
    } finally {
      Date.now = realDateNow;
    }

    expect(response.success).toBe(true);
    expect(response.gamesCount).toBe(0);
    expect(response.error).toBeUndefined();
    expect(response.appState?.availableGames).toEqual([]);
    expect(response.appState?.selectedGame).toBeNull();
    expect(response.appState?.pendingDrops).toEqual([]);
    expect(response.appState?.completedDrops).toEqual([]);
    expect(response.appState?.allDrops).toEqual([]);
    expect(response.appState?.queue).toEqual([]);
    expect(response.appState?.dropsPageRefreshInProgress).toBe(false);
  });
}
