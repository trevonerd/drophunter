import { describe, expect, test } from 'bun:test';
import { createInitialState } from '../src/shared/utils.ts';
import type { ClaimLogEntry } from '../src/types/index.ts';
import {
  createTelegramNotifier,
  formatClaimNotificationMessage,
  isValidBotToken,
  isValidChatId,
  normalizeTelegramCredentials,
  TELEGRAM_TEST_MESSAGE,
} from '../src/background/telegram-notifications.ts';

const sampleEntry: ClaimLogEntry = {
  id: 'drop-1',
  dropId: 'drop-1',
  dropName: 'Exclusive Skin',
  benefitName: 'Winter Bundle',
  gameId: 'game-1',
  gameName: 'Marvel Rivals',
  campaignLabel: 'Marvel Rivals · Winter Campaign',
  claimedAt: Date.parse('2026-06-30T14:32:00Z'),
  imageUrl: 'https://static-cdn.jtvnw.net/image.png',
};

describe('telegram notification helpers', () => {
  test('validates bot token and chat id formats', () => {
    expect(isValidBotToken('123456:ABCdefGHIjklMNOpqrsTUVwxyz')).toBe(true);
    expect(isValidBotToken('invalid-token')).toBe(false);
    expect(isValidChatId('123456789')).toBe(true);
    expect(isValidChatId('@mychannel')).toBe(true);
    expect(isValidChatId('')).toBe(false);
  });

  test('normalizes stored credentials', () => {
    expect(
      normalizeTelegramCredentials({
        botToken: ' 123:abc ',
        chatId: ' 999 ',
      }),
    ).toEqual({ botToken: '123:abc', chatId: '999' });
    expect(normalizeTelegramCredentials({ botToken: 'bad', chatId: '1' })).toBeNull();
  });

  test('formats English claim notification HTML', () => {
    const message = formatClaimNotificationMessage(sampleEntry, {
      selectedGameLabel: 'Marvel Rivals · Winter Campaign',
      activeStreamerName: 'StreamerOne',
    });

    expect(message).toContain('Drop claimed');
    expect(message).toContain('<b>Exclusive Skin</b>');
    expect(message).toContain('Marvel Rivals · Winter Campaign');
    expect(message).toContain('Reward: Winter Bundle');
    expect(message).toContain('Streamer: StreamerOne');
  });
});

describe('telegram notifier', () => {
  test('skips alerts when disabled', async () => {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: false } };
    const fetchCalls: string[] = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '1' }),
      saveCredentials: async () => undefined,
      permissionsApi: {
        contains: async () => true,
        request: async () => true,
      },
      fetchApi: async (url) => {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await notifier.notifyClaimedDrops([sampleEntry]);
    expect(fetchCalls).toEqual([]);
  });

  test('sends sendPhoto when imageUrl is available', async () => {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: true } };
    const bodies: Array<Record<string, unknown>> = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '999' }),
      saveCredentials: async () => undefined,
      permissionsApi: {
        contains: async () => true,
        request: async () => true,
      },
      fetchApi: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await notifier.notifyClaimedDrops([sampleEntry]);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.photo).toBe(sampleEntry.imageUrl);
    expect(bodies[0]?.chat_id).toBe('999');
    expect(String(bodies[0]?.caption)).toContain('Drop claimed');
  });

  test('falls back to sendMessage without imageUrl', async () => {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: true } };
    const urls: string[] = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '999' }),
      saveCredentials: async () => undefined,
      permissionsApi: {
        contains: async () => true,
        request: async () => true,
      },
      fetchApi: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await notifier.notifyClaimedDrops([{ ...sampleEntry, imageUrl: undefined }]);

    expect(urls[0]).toContain('/sendMessage');
  });

  test('disables preference when host permission is missing', async () => {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: true } };
    let saved = false;
    const notifier = createTelegramNotifier(state, {
      saveState: async () => {
        saved = true;
      },
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '999' }),
      saveCredentials: async () => undefined,
      permissionsApi: {
        contains: async () => false,
        request: async () => false,
      },
      fetchApi: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    await notifier.notifyClaimedDrops([sampleEntry]);

    expect(state.appState.telegramAlertsEnabled).toBe(false);
    expect(saved).toBe(true);
  });

  test('sendTestAlert uses the English test copy', async () => {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: true } };
    const bodies: Array<Record<string, unknown>> = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '999' }),
      saveCredentials: async () => undefined,
      permissionsApi: {
        contains: async () => true,
        request: async () => true,
      },
      fetchApi: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    const result = await notifier.sendTestAlert();
    expect(result.success).toBe(true);
    expect(bodies[0]?.text).toBe(TELEGRAM_TEST_MESSAGE);
  });
});
