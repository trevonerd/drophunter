import { describe, expect, test } from 'bun:test';
import {
  createTelegramNotifier,
  TELEGRAM_TEST_MESSAGE,
} from '../../src/background/telegram-notifications.ts';
import { createInitialState } from '../../src/shared/utils.ts';
import type { ClaimLogEntry } from '../../src/types/index.ts';

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

  test('notifySystemEvent skips when the system-alerts sub-toggle is off', async () => {
    const state = {
      appState: { ...createInitialState(), telegramAlertsEnabled: true, telegramSystemAlertsEnabled: false },
    };
    const fetchCalls: string[] = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '1' }),
      saveCredentials: async () => undefined,
      permissionsApi: { contains: async () => true, request: async () => true },
      fetchApi: async (url) => {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await notifier.notifySystemEvent('auto-started', 'Marvel Rivals started automatically.');
    expect(fetchCalls).toEqual([]);
  });

  test('notifySystemEvent skips when master Telegram alerts are off, even if the sub-toggle is on', async () => {
    const state = {
      appState: { ...createInitialState(), telegramAlertsEnabled: false, telegramSystemAlertsEnabled: true },
    };
    const fetchCalls: string[] = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '1' }),
      saveCredentials: async () => undefined,
      permissionsApi: { contains: async () => true, request: async () => true },
      fetchApi: async (url) => {
        fetchCalls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await notifier.notifySystemEvent('auto-started', 'Marvel Rivals started automatically.');
    expect(fetchCalls).toEqual([]);
  });

  test('notifySystemEvent sends a formatted sendMessage when both toggles are on', async () => {
    const state = {
      appState: { ...createInitialState(), telegramAlertsEnabled: true, telegramSystemAlertsEnabled: true },
    };
    const bodies: Array<Record<string, unknown>> = [];
    const notifier = createTelegramNotifier(state, {
      saveState: async () => undefined,
      loadCredentials: async () => ({ botToken: '123:abc', chatId: '999' }),
      saveCredentials: async () => undefined,
      permissionsApi: { contains: async () => true, request: async () => true },
      fetchApi: async (url, init) => {
        expect(String(url)).toContain('sendMessage');
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await notifier.notifySystemEvent('queue-complete', 'Queue completed. No pending rewards left.');
    expect(bodies[0]?.text).toContain('🏁 Queue complete');
    expect(bodies[0]?.text).toContain('Queue completed. No pending rewards left.');
  });
});
