import { describe, expect, test } from 'bun:test';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { callListener, createHandlers } from '../support/message-router-fixtures.ts';

describe('runtime message router', () => {
  test('dispatches GET_CLAIM_LOG and CLEAR_CLAIM_LOG to the correct handlers', async () => {
    const fakeEntries = [
      {
        id: 'e1',
        dropId: 'd1',
        dropName: 'Drop',
        gameId: 'g1',
        gameName: 'Game',
        campaignLabel: 'Game',
        claimedAt: 1000,
      },
    ];
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
        setTelegramSystemAlertsEnabled: async () => ({ success: true, telegramSystemAlertsEnabled: true }),
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
    const systemEnabled = await callListener(listener, {
      type: 'SET_TELEGRAM_SYSTEM_ALERTS_ENABLED',
      payload: { enabled: true },
    });

    expect(settings.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(test.response).toEqual({ success: true });
    expect(credentials.response).toEqual({ success: true, configured: true, chatId: '123' });
    expect(enabled.response).toEqual({ success: true, telegramAlertsEnabled: true });
    expect(systemEnabled.response).toEqual({ success: true, telegramSystemAlertsEnabled: true });
  });
});
