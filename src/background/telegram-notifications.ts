import { browser } from '../shared/browser-api.ts';
import type { ClaimLogEntry } from '../types/index.ts';
import { TELEGRAM_CREDENTIALS_KEY } from './constants.ts';
import { logWarn } from './logging.ts';
import {
  callTelegramApi,
  formatClaimNotificationMessage,
  formatSystemEventMessage,
  normalizeTelegramCredentials,
  TELEGRAM_HOST_PERMISSION,
  TELEGRAM_TEST_MESSAGE,
  type TelegramCredentials,
  type TelegramNotifierOptions,
  type TelegramNotifierState,
  type TelegramNotifyContext,
} from './telegram-notification-core.ts';
import { createTelegramNotifierSettings } from './telegram-notifier-settings.ts';

export type {
  TelegramCredentials,
  TelegramNotifyContext,
  TelegramSystemEventReason,
} from './telegram-notification-core.ts';
export {
  formatClaimNotificationMessage,
  formatSystemEventMessage,
  isValidBotToken,
  isValidChatId,
  normalizeTelegramCredentials,
  TELEGRAM_HOST_PERMISSION,
  TELEGRAM_TEST_MESSAGE,
} from './telegram-notification-core.ts';

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
    if (!state.appState.telegramAlertsEnabled || (await hasTelegramHostPermission())) return;
    state.appState.telegramAlertsEnabled = false;
    await options.saveState();
  };
  const buildNotifyContext = (): TelegramNotifyContext => ({
    selectedGameLabel: state.appState.selectedGame?.displayName ?? state.appState.selectedGame?.name ?? null,
    activeStreamerName: state.appState.activeStreamer?.displayName ?? null,
  });
  const sendMessage = async (credentials: TelegramCredentials, text: string, photoUrl?: string) => {
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
  const ensureReadyToSend = async (): Promise<TelegramCredentials | null> => {
    if (!state.appState.telegramAlertsEnabled) return null;
    if (!(await hasTelegramHostPermission())) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return null;
    }
    return options.loadCredentials();
  };
  const notifyClaimedDrops = async (entries: ClaimLogEntry[]): Promise<void> => {
    if (entries.length === 0) return;
    const credentials = await ensureReadyToSend();
    if (!credentials) return;
    const context = buildNotifyContext();
    for (const entry of entries) {
      try {
        await sendMessage(credentials, formatClaimNotificationMessage(entry, context), entry.imageUrl);
      } catch (error) {
        logWarn('Telegram claim alert failed:', String(error));
      }
    }
  };
  const notifySystemEvent = async (reason: string, message: string): Promise<void> => {
    if (!state.appState.telegramSystemAlertsEnabled) return;
    const credentials = await ensureReadyToSend();
    if (!credentials) return;
    try {
      await sendMessage(credentials, formatSystemEventMessage(reason, message));
    } catch (error) {
      logWarn('Telegram system alert failed:', String(error));
    }
  };
  const validateSetup = async (credentials: TelegramCredentials) => {
    try {
      await callTelegramApi(credentials.botToken, 'getMe', {}, fetchApi);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  };
  const sendTestAlert = async () => {
    if (!(await hasTelegramHostPermission())) {
      return { success: false, error: 'Telegram host permission was not granted' };
    }
    const credentials = await options.loadCredentials();
    if (!credentials) return { success: false, error: 'Telegram bot token and chat ID are required' };
    try {
      await sendMessage(credentials, TELEGRAM_TEST_MESSAGE);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  };
  const settings = createTelegramNotifierSettings(state, options, {
    hasPermission: hasTelegramHostPermission,
    requestPermission: requestTelegramHostPermission,
    validateSetup,
  });
  return {
    hasTelegramHostPermission,
    requestTelegramHostPermission,
    syncPermissionState,
    notifyClaimedDrops,
    notifySystemEvent,
    validateSetup,
    sendTestAlert,
    ...settings,
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

export async function getTelegramSettingsSummary() {
  const credentials = await loadTelegramCredentials();
  return { configured: credentials !== null, chatId: credentials?.chatId ?? null };
}
