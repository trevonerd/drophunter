import { describe, expect, test } from 'bun:test';
import {
  createTelegramNotifier,
  formatClaimNotificationMessage,
  isValidBotToken,
  isValidChatId,
  normalizeTelegramCredentials,
  TELEGRAM_TEST_MESSAGE,
} from '../src/background/telegram-notifications.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { ClaimLogEntry } from '../src/types/index.ts';

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

describe('telegram notifier setTelegramAlertsEnabled', () => {
  function createNotifierHarness(overrides: {
    permissionGranted?: boolean;
    permissionRequestGranted?: boolean;
    credentials?: { botToken: string; chatId: string } | null;
    fetchOk?: boolean;
    fetchDescription?: string;
  }) {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: false } };
    const stats = { saveCount: 0, savedEnabled: false as boolean };
    const fetchCalls: string[] = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => {
        stats.saveCount += 1;
        stats.savedEnabled = state.appState.telegramAlertsEnabled;
      },
      loadCredentials: async () => overrides.credentials ?? null,
      saveCredentials: async () => undefined,
      permissionsApi: {
        contains: async () => overrides.permissionGranted ?? true,
        request: async () => overrides.permissionRequestGranted ?? true,
      },
      fetchApi: async (url) => {
        fetchCalls.push(String(url));
        return new Response(
          JSON.stringify({
            ok: overrides.fetchOk ?? true,
            description: overrides.fetchDescription,
          }),
          { status: 200 },
        );
      },
    });
    return { state, stats, fetchCalls, notifier };
  }

  test('disables the preference when the user turns it off', async () => {
    const state = { appState: { ...createInitialState(), telegramAlertsEnabled: true } };
    let saveCount = 0;
    const notifier = createTelegramNotifier(state, {
      saveState: async () => {
        saveCount += 1;
      },
      loadCredentials: async () => null,
      saveCredentials: async () => undefined,
      permissionsApi: { contains: async () => true, request: async () => true },
      fetchApi: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    const result = await notifier.setTelegramAlertsEnabled(false);

    expect(result).toEqual({ success: true, telegramAlertsEnabled: false });
    expect(state.appState.telegramAlertsEnabled).toBe(false);
    expect(saveCount).toBe(1);
  });

  test('errors and flips the preference off when no credentials are stored', async () => {
    const harness = createNotifierHarness({ credentials: null });

    const result = await harness.notifier.setTelegramAlertsEnabled(true);

    expect(result.success).toBe(false);
    expect(result.telegramAlertsEnabled).toBe(false);
    expect(result.error).toBe('Telegram bot token and chat ID are required');
    expect(harness.state.appState.telegramAlertsEnabled).toBe(false);
    expect(harness.stats.saveCount).toBe(1);
    expect(harness.fetchCalls).toEqual([]);
  });

  test('errors and flips the preference off when host permission is missing and request denied', async () => {
    const harness = createNotifierHarness({
      permissionGranted: false,
      permissionRequestGranted: false,
      credentials: { botToken: '123:abc', chatId: '999' },
    });

    const result = await harness.notifier.setTelegramAlertsEnabled(true);

    expect(result.success).toBe(false);
    expect(result.telegramAlertsEnabled).toBe(false);
    expect(result.error).toBe('Telegram host permission was not granted');
    expect(harness.state.appState.telegramAlertsEnabled).toBe(false);
    expect(harness.stats.saveCount).toBe(1);
    expect(harness.fetchCalls).toEqual([]);
  });

  test('enables the preference when credentials, host permission, and getMe all succeed', async () => {
    const harness = createNotifierHarness({
      permissionGranted: true,
      credentials: { botToken: '123:abc', chatId: '999' },
      fetchOk: true,
    });

    const result = await harness.notifier.setTelegramAlertsEnabled(true);

    expect(result).toEqual({ success: true, telegramAlertsEnabled: true });
    expect(harness.state.appState.telegramAlertsEnabled).toBe(true);
    expect(harness.stats.saveCount).toBe(1);
    expect(harness.fetchCalls[0]).toContain('/getMe');
  });

  test('errors and flips the preference off when the getMe probe fails', async () => {
    const harness = createNotifierHarness({
      permissionGranted: true,
      credentials: { botToken: '123:abc', chatId: '999' },
      fetchOk: false,
      fetchDescription: 'Unauthorized',
    });

    const result = await harness.notifier.setTelegramAlertsEnabled(true);

    expect(result.success).toBe(false);
    expect(result.telegramAlertsEnabled).toBe(false);
    expect(result.error).toBe('Error: Unauthorized');
    expect(harness.state.appState.telegramAlertsEnabled).toBe(false);
    expect(harness.stats.saveCount).toBe(1);
  });
});

describe('telegram notifier setTelegramCredentials', () => {
  function createCredentialHarness(overrides: {
    existing?: { botToken: string; chatId: string } | null;
    permissionGranted?: boolean;
    permissionRequestGranted?: boolean;
    fetchOk?: boolean;
  }) {
    const state = { appState: { ...createInitialState() } };
    const savedCredentials: Array<{ botToken: string; chatId: string } | null> = [];
    const fetchCalls: string[] = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => overrides.existing ?? null,
      saveCredentials: async (credentials) => {
        savedCredentials.push(credentials);
      },
      permissionsApi: {
        contains: async () => overrides.permissionGranted ?? true,
        request: async () => overrides.permissionRequestGranted ?? true,
      },
      fetchApi: async (url) => {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ ok: overrides.fetchOk ?? true }), { status: 200 });
      },
    });
    return { savedCredentials, fetchCalls, notifier };
  }

  test('returns configured=false when clearing with no existing credentials', async () => {
    const harness = createCredentialHarness({ existing: null });

    const result = await harness.notifier.setTelegramCredentials({ clearToken: true });

    expect(result).toEqual({ success: true, configured: false, chatId: null });
    expect(harness.savedCredentials).toEqual([]);
    expect(harness.fetchCalls).toEqual([]);
  });

  test('errors when clearing with existing credentials', async () => {
    const harness = createCredentialHarness({
      existing: { botToken: '123:abc', chatId: '999' },
    });

    const result = await harness.notifier.setTelegramCredentials({ clearToken: true });

    expect(result).toEqual({
      success: false,
      error: 'Telegram bot token and chat ID are required',
    });
    expect(harness.savedCredentials).toEqual([]);
  });

  test('errors when the bot token format is invalid', async () => {
    const harness = createCredentialHarness({ existing: null });

    const result = await harness.notifier.setTelegramCredentials({
      botToken: 'not-a-token',
      chatId: '999',
    });

    expect(result).toEqual({
      success: false,
      error: 'Telegram bot token format is invalid',
    });
    expect(harness.savedCredentials).toEqual([]);
  });

  test('errors when the chat ID format is invalid', async () => {
    const harness = createCredentialHarness({ existing: null });

    const result = await harness.notifier.setTelegramCredentials({
      botToken: '123:abc',
      chatId: '',
    });

    expect(result).toEqual({
      success: false,
      error: 'Telegram bot token and chat ID are required',
    });
    expect(harness.savedCredentials).toEqual([]);
  });

  test('persists normalized credentials and returns configured=true when everything succeeds', async () => {
    const harness = createCredentialHarness({
      existing: null,
      permissionGranted: true,
      fetchOk: true,
    });

    const result = await harness.notifier.setTelegramCredentials({
      botToken: ' 123:abc ',
      chatId: ' 999 ',
    });

    expect(result).toEqual({
      success: true,
      configured: true,
      chatId: '999',
    });
    expect(harness.savedCredentials).toEqual([{ botToken: '123:abc', chatId: '999' }]);
    expect(harness.fetchCalls[0]).toContain('/getMe');
  });

  test('falls back to existing credentials and saves when only chatId is provided', async () => {
    const harness = createCredentialHarness({
      existing: { botToken: '123:abc', chatId: '999' },
      permissionGranted: true,
      fetchOk: true,
    });

    const result = await harness.notifier.setTelegramCredentials({
      chatId: ' 1000 ',
    });

    expect(result).toEqual({
      success: true,
      configured: true,
      chatId: '1000',
    });
    expect(harness.savedCredentials).toEqual([{ botToken: '123:abc', chatId: '1000' }]);
  });

  test('errors when host permission cannot be obtained', async () => {
    const harness = createCredentialHarness({
      existing: null,
      permissionGranted: false,
      permissionRequestGranted: false,
    });

    const result = await harness.notifier.setTelegramCredentials({
      botToken: '123:abc',
      chatId: '999',
    });

    expect(result).toEqual({
      success: false,
      error: 'Telegram host permission was not granted',
    });
    expect(harness.savedCredentials).toEqual([]);
  });

  test('errors when the getMe probe fails', async () => {
    const harness = createCredentialHarness({
      existing: null,
      permissionGranted: true,
      fetchOk: false,
    });

    const result = await harness.notifier.setTelegramCredentials({
      botToken: '123:abc',
      chatId: '999',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Error: Telegram API getMe failed');
    expect(harness.savedCredentials).toEqual([]);
  });
});
