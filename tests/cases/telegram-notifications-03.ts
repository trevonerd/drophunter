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
