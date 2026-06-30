import { describe, expect, test } from 'bun:test';
import {
  createRuntimeMessageListener,
  type RuntimeMessageHandlers,
} from '../src/background/message-router.ts';

function createHandlers(overrides: Partial<RuntimeMessageHandlers> = {}): RuntimeMessageHandlers {
  const missing = () => {
    throw new Error('unexpected handler');
  };

  return {
    ensureGamesCache: missing,
    openDropsPageAndRefresh: missing,
    markDropsRefreshNoticeSeen: missing,
    addToQueue: missing,
    removeFromQueue: missing,
    clearQueue: missing,
    startFarming: missing,
    setSelectedGame: missing,
    pauseFarming: missing,
    setAutoResumeOnStartup: missing,
    resumeFarming: missing,
    stopFarming: missing,
    updateGames: missing,
    syncTwitchSession: missing,
    syncTwitchIntegrity: missing,
    refreshDrops: missing,
    setMonitorAutoOpen: missing,
    setMuteFarmingTab: missing,
    setNotificationsEnabled: missing,
    setTelegramAlertsEnabled: missing,
    setTelegramCredentials: missing,
    testTelegramAlerts: missing,
    getTelegramSettings: missing,
    setAutoClaimChannelPointsBonus: missing,
    channelPointsBonusClaimed: missing,
    setAutoClaimDrops: missing,
    setStreamerSelectionMode: missing,
    setPreferredStreamerLanguage: missing,
    openMonitorDashboard: missing,
    getClaimLog: missing,
    clearClaimLog: missing,
    ...overrides,
  };
}

async function callListener(
  listener: ReturnType<typeof createRuntimeMessageListener>,
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
) {
  let response: unknown;
  const keepChannelOpen = listener(message, sender, (value?: unknown) => {
    response = value;
  });
  await Promise.resolve();
  await Promise.resolve();
  return { keepChannelOpen, response };
}

describe('runtime message router', () => {
  test('rejects unknown messages without invoking handlers', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'NOT_A_REAL_MESSAGE' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('rejects critical messages with malformed payloads before invoking handlers', async () => {
    let startCalled = false;
    let syncCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        startFarming: async () => {
          startCalled = true;
          return { success: true };
        },
        syncTwitchIntegrity: async () => {
          syncCalled = true;
          return { success: true };
        },
      }),
    );

    const start = await callListener(listener, { type: 'START_FARMING', payload: { game: null } });
    const integrity = await callListener(listener, {
      type: 'SYNC_TWITCH_INTEGRITY',
      payload: { token: 123 },
    });

    expect(start.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(integrity.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(startCalled).toBe(false);
    expect(syncCalled).toBe(false);
  });

  test('rejects messages that are not handled by the background service worker', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'GET_STREAM_CONTEXT' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unsupported message target' });
  });

  test('dispatches GET_CLAIM_LOG and CLEAR_CLAIM_LOG to the correct handlers', async () => {
    const fakeEntries = [{ id: 'e1', dropId: 'd1', dropName: 'Drop', gameId: 'g1', gameName: 'Game', campaignLabel: 'Game', claimedAt: 1000 }];
    const listener = createRuntimeMessageListener(
      createHandlers({
        getClaimLog: async () => ({ success: true, entries: fakeEntries }),
        clearClaimLog: async () => ({ success: true }),
      }),
    );

    const get = await callListener(listener, { type: 'GET_CLAIM_LOG' });
    const clear = await callListener(listener, { type: 'CLEAR_CLAIM_LOG' });

    expect(get.response).toEqual({ success: true, entries: fakeEntries });
    expect(clear.response).toEqual({ success: true });
  });

  test('dispatches Telegram settings messages to the correct handlers', async () => {
    const listener = createRuntimeMessageListener(
      createHandlers({
        getTelegramSettings: async () => ({ success: true, configured: true, chatId: '123' }),
        testTelegramAlerts: async () => ({ success: true }),
        setTelegramCredentials: async () => ({ success: true, configured: true, chatId: '123' }),
        setTelegramAlertsEnabled: async () => ({ success: true, telegramAlertsEnabled: true }),
      }),
    );

    const settings = await callListener(listener, { type: 'GET_TELEGRAM_SETTINGS' });
    const test = await callListener(listener, { type: 'TEST_TELEGRAM_ALERTS' });
    const credentials = await callListener(listener, {
      type: 'SET_TELEGRAM_CREDENTIALS',
      payload: { botToken: '123:abc', chatId: '123' },
    });
    const enabled = await callListener(listener, {
      type: 'SET_TELEGRAM_ALERTS_ENABLED',
      payload: { enabled: true },
    });

    expect(settings.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(test.response).toEqual({ success: true });
    expect(credentials.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(enabled.response).toEqual({ success: true, telegramAlertsEnabled: true });
  });

  test('returns async handler results and converts thrown errors into response errors', async () => {
    const listener = createRuntimeMessageListener(
      createHandlers({
        pauseFarming: async () => ({ success: true, paused: true }),
        resumeFarming: async () => {
          throw new Error('resume failed');
        },
      }),
    );

    const pause = await callListener(listener, { type: 'PAUSE_FARMING' });
    const resume = await callListener(listener, { type: 'RESUME_FARMING' });

    expect(pause.response).toEqual({ success: true, paused: true });
    expect(resume.response).toEqual({ success: false, error: 'Error: resume failed' });
  });
});
