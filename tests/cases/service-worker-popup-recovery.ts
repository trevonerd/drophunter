import { expect, test } from 'bun:test';
import { demoGame } from '../fixtures/service-worker-games.ts';
import { enqueueDropsSnapshot } from '../helpers/service-worker-fetch.ts';
import { chromeMocks, dispatchMessage, getAppStateFromStorage } from '../helpers/service-worker-harness.ts';

export function registerPopupActivationRecoveryCase() {
  test('ACTIVATE_POPUP recovers a missing session through a background Twitch tab', async () => {
    const chrome = chromeMocks.chrome;
    const createdActiveValues: boolean[] = [];
    chromeMocks.tabs.setTabsQueryResult([]);
    chrome.tabs.create = async ({ url, active }) => {
      createdActiveValues.push(Boolean(active));
      return { id: 320, windowId: 1, url, active: Boolean(active), status: 'complete' };
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
    enqueueDropsSnapshot([{ game: demoGame, dropId: 'drop-popup-recovery', currentMinutes: 0 }]);

    const response = (await dispatchMessage({ type: 'ACTIVATE_POPUP' })) as {
      success?: boolean;
      result?: { kind?: string; campaignCount?: number };
    };

    expect(response.success).toBe(true);
    expect(response.result).toMatchObject({ kind: 'synced', campaignCount: 1 });
    expect(createdActiveValues).toEqual([false]);
    expect(getAppStateFromStorage().availableGames).toHaveLength(1);
  });
}
