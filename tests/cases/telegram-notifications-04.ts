import { describe, expect, test } from 'bun:test';
import { createTelegramNotifier } from '../../src/background/telegram-notifications.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { ClaimLogEntry } from '../../src/types/index.ts';

const _sampleEntry: ClaimLogEntry = {
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
