import { browser } from '../shared/browser-api.ts';
import type { AppState, ClaimLogEntry } from '../types/index.ts';
import { TELEGRAM_CREDENTIALS_KEY } from './constants.ts';
import { logWarn } from './logging.ts';

export const TELEGRAM_HOST_PERMISSION: chrome.permissions.Permissions = {
  origins: ['https://api.telegram.org/*'],
};

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export interface TelegramNotifyContext {
  selectedGameLabel?: string | null;
  activeStreamerName?: string | null;
}

interface TelegramNotifierState {
  appState: Pick<AppState, 'telegramAlertsEnabled' | 'selectedGame' | 'activeStreamer'>;
}

interface TelegramNotifierOptions {
  permissionsApi?: Pick<typeof chrome.permissions, 'contains' | 'request'>;
  fetchApi?: typeof fetch;
  saveState: () => Promise<unknown> | unknown;
  loadCredentials: () => Promise<TelegramCredentials | null>;
  saveCredentials: (credentials: TelegramCredentials | null) => Promise<void>;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isValidBotToken(token: string): boolean {
  return BOT_TOKEN_PATTERN.test(token.trim());
}

export function isValidChatId(chatId: string): boolean {
  const trimmed = chatId.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('@')) {
    return trimmed.length > 1;
  }
  return /^-?\d+$/.test(trimmed);
}

export function normalizeTelegramCredentials(raw: unknown): TelegramCredentials | null {
  if (!isRecord(raw)) {
    return null;
  }
  const botToken = typeof raw.botToken === 'string' ? raw.botToken.trim() : '';
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : '';
  if (!isValidBotToken(botToken) || !isValidChatId(chatId)) {
    return null;
  }
  return { botToken, chatId };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatClaimedAt(claimedAt: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(claimedAt));
}

export function formatClaimNotificationMessage(
  entry: ClaimLogEntry,
  context: TelegramNotifyContext = {},
): string {
  const lines = ['🎁 <b>Drop claimed</b>', ''];
  lines.push(`<b>${escapeHtml(entry.dropName)}</b>`);
  lines.push(escapeHtml(entry.campaignLabel || entry.gameName || 'Twitch Drop'));
  lines.push('');

  if (entry.benefitName) {
    lines.push(`▸ Reward: ${escapeHtml(entry.benefitName)}`);
  }
  lines.push(`▸ Claimed: ${escapeHtml(formatClaimedAt(entry.claimedAt))}`);

  if (context.selectedGameLabel) {
    lines.push(`▸ Farming: ${escapeHtml(context.selectedGameLabel)}`);
  }
  if (context.activeStreamerName) {
    lines.push(`▸ Streamer: ${escapeHtml(context.activeStreamerName)}`);
  }

  return lines.join('\n');
}

export const TELEGRAM_TEST_MESSAGE = 'DropHunter test — Telegram alerts are working.';

async function callTelegramApi<T extends TelegramApiResponse>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchApi: typeof fetch,
): Promise<T> {
  const response = await fetchApi(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload?.ok) {
    throw new Error(payload?.description ?? `Telegram API ${method} failed`);
  }
  return payload;
}

export function createTelegramNotifier(state: TelegramNotifierState, options: TelegramNotifierOptions) {
  const permissionsApi = options.permissionsApi ?? browser.permissions;
  const fetchApi = options.fetchApi ?? fetch;

  const hasTelegramHostPermission = async (): Promise<boolean> => {
    try {
      return await permissionsApi.contains(TELEGRAM_HOST_PERMISSION);
    } catch {
      return false;
    }
  };

  const requestTelegramHostPermission = async (): Promise<boolean> => {
    try {
      return await permissionsApi.request(TELEGRAM_HOST_PERMISSION);
    } catch {
      return false;
    }
  };

  const syncPermissionState = async () => {
    if (!state.appState.telegramAlertsEnabled) {
      return;
    }
    if (await hasTelegramHostPermission()) {
      return;
    }
    state.appState.telegramAlertsEnabled = false;
    await options.saveState();
  };

  const buildNotifyContext = (): TelegramNotifyContext => ({
    selectedGameLabel: state.appState.selectedGame?.displayName ?? state.appState.selectedGame?.name ?? null,
    activeStreamerName: state.appState.activeStreamer?.displayName ?? null,
  });

  const sendMessage = async (
    credentials: TelegramCredentials,
    text: string,
    photoUrl?: string,
  ): Promise<void> => {
    if (photoUrl) {
      await callTelegramApi(
        credentials.botToken,
        'sendPhoto',
        {
          chat_id: credentials.chatId,
          photo: photoUrl,
          caption: text,
          parse_mode: 'HTML',
        },
        fetchApi,
      );
      return;
    }

    await callTelegramApi(
      credentials.botToken,
      'sendMessage',
      {
        chat_id: credentials.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      fetchApi,
    );
  };

  const notifyClaimedDrops = async (entries: ClaimLogEntry[]): Promise<void> => {
    if (!state.appState.telegramAlertsEnabled || entries.length === 0) {
      return;
    }
    if (!(await hasTelegramHostPermission())) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return;
    }

    const credentials = await options.loadCredentials();
    if (!credentials) {
      return;
    }

    const context = buildNotifyContext();
    for (const entry of entries) {
      try {
        const message = formatClaimNotificationMessage(entry, context);
        await sendMessage(credentials, message, entry.imageUrl);
      } catch (error) {
        logWarn('Telegram claim alert failed:', String(error));
      }
    }
  };

  const validateSetup = async (
    credentials: TelegramCredentials,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await callTelegramApi(credentials.botToken, 'getMe', {}, fetchApi);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  };

  const sendTestAlert = async (): Promise<{ success: boolean; error?: string }> => {
    if (!(await hasTelegramHostPermission())) {
      return { success: false, error: 'Telegram host permission was not granted' };
    }

    const credentials = await options.loadCredentials();
    if (!credentials) {
      return { success: false, error: 'Telegram bot token and chat ID are required' };
    }

    try {
      await sendMessage(credentials, TELEGRAM_TEST_MESSAGE);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  };

  return {
    hasTelegramHostPermission,
    requestTelegramHostPermission,
    syncPermissionState,
    notifyClaimedDrops,
    validateSetup,
    sendTestAlert,
  };
}

export async function loadTelegramCredentials(): Promise<TelegramCredentials | null> {
  try {
    const stored = await browser.storage.local.get([TELEGRAM_CREDENTIALS_KEY]);
    return normalizeTelegramCredentials(stored[TELEGRAM_CREDENTIALS_KEY]);
  } catch (error) {
    logWarn('Failed to load Telegram credentials:', String(error));
    return null;
  }
}

export async function saveTelegramCredentials(credentials: TelegramCredentials | null): Promise<void> {
  if (!credentials) {
    await browser.storage.local.remove(TELEGRAM_CREDENTIALS_KEY);
    return;
  }
  await browser.storage.local.set({ [TELEGRAM_CREDENTIALS_KEY]: credentials });
}

export async function getTelegramSettingsSummary(): Promise<{
  configured: boolean;
  chatId: string | null;
}> {
  const credentials = await loadTelegramCredentials();
  return {
    configured: credentials !== null,
    chatId: credentials?.chatId ?? null,
  };
}
