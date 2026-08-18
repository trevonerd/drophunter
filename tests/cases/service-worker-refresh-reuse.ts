import { expect, test } from 'bun:test';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { enqueueDropsSnapshot } from '../helpers/service-worker-fetch.ts';
import {
  chromeMocks,
  dispatchMessage,
  getAppStateFromStorage,
  sleepTick,
} from '../helpers/service-worker-harness.ts';

export function registerRefreshReuseCases() {
  test('OPEN_DROPS_PAGE_AND_REFRESH reuses an existing Twitch Drops tab', async () => {
    const chrome = chromeMocks.chrome;
    let createCalls = 0;
    let updateCalls = 0;
    chromeMocks.tabs.setTabsQueryResult([
      { id: 654, url: 'https://www.twitch.tv/drops/campaigns', status: 'complete', windowId: 1 },
    ]);
    chrome.tabs.create = async () => {
      createCalls += 1;
      return { id: 999, windowId: 1, status: 'complete' };
    };
    chrome.tabs.update = async (tabId, updateProperties) => {
      updateCalls += 1;
      return { id: tabId, windowId: 1, active: Boolean(updateProperties?.active), status: 'complete' };
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
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-existing-tab', currentMinutes: 0 }]);

    const response = (await dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' })) as {
      success?: boolean;
      opened?: boolean;
    };

    expect(response.success).toBe(true);
    expect(response.opened).toBe(false);
    expect(createCalls).toBe(0);
    expect(updateCalls).toBe(1);
    expect(getAppStateFromStorage().availableGames).toHaveLength(1);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH returns success true when hidden fetch finds games', async () => {
    const chrome = chromeMocks.chrome;
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url, active }) => ({
      id: 888,
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
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-refresh-success', currentMinutes: 0 }]);

    const response = (await dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' })) as {
      success?: boolean;
      gamesCount?: number;
      appState?: AppState;
    };

    expect(response.success).toBe(true);
    expect(response.gamesCount).toBe(1);
    expect(response.appState?.availableGames).toHaveLength(1);
  });

  test('OPEN_DROPS_PAGE_AND_REFRESH shares concurrent refresh work', async () => {
    const chrome = chromeMocks.chrome;
    let createCalls = 0;
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url }) => {
      createCalls += 1;
      await sleepTick();
      return { id: 777, windowId: 1, url, status: 'complete' };
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
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-concurrent-open', currentMinutes: 0 }]);

    const [first, second] = (await Promise.all([
      dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' }),
      dispatchMessage({ type: 'OPEN_DROPS_PAGE_AND_REFRESH' }),
    ])) as Array<{ success?: boolean; gamesCount?: number }>;

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.gamesCount).toBe(1);
    expect(second.gamesCount).toBe(1);
    expect(createCalls).toBe(1);
  });
}
