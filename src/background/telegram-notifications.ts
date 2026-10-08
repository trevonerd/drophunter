import { browser } from '../shared/browser-api.ts';
import type { ClaimLogEntry } from '../types/index.ts';
import { TELEGRAM_CREDENTIALS_KEY } from './constants.ts';
import { logWarn } from './logging.ts';
import {
  callTelegramApi,
  formatClaimNotificationMessage,
  formatSystemEventMessage,
  isValidBotToken,
  isValidChatId,
  normalizeTelegramCredentials,
  TELEGRAM_HOST_PERMISSION,
  TELEGRAM_TEST_MESSAGE,
  type TelegramCredentials,
  type TelegramNotifierOptions,
  type TelegramNotifierState,
  type TelegramNotifyContext,
} from './telegram-notification-core.ts';

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
  const syncPermissionState = async () => {
    if (!state.appState.telegramAlertsEnabled || (await hasTelegramHostPermission())) return;
    state.appState.telegramAlertsEnabled = false;
    await options.saveState();
  };
  const buildNotifyContext = (entry: ClaimLogEntry): TelegramNotifyContext => {
    const selectedGame = state.appState.selectedGame;
    const matchesClaimedCampaign = entry.campaignId
      ? selectedGame?.campaignId === entry.campaignId
      : Boolean(entry.gameId) && selectedGame?.id === entry.gameId;
    return {
      activeStreamerName: matchesClaimedCampaign
        ? (state.appState.activeStreamer?.displayName ?? null)
        : null,
    };
  };
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
    for (const entry of entries) {
      try {
        await sendMessage(
          credentials,
          formatClaimNotificationMessage(entry, buildNotifyContext(entry)),
          entry.imageUrl,
        );
      } catch (error) {
        logWarn('Telegram claim alert failed:', String(error));
      }
    }
  };
  const notifySystemEvent = async (reason: string, message: string): Promise<boolean> => {
    if (!state.appState.telegramSystemAlertsEnabled) return false;
    const credentials = await ensureReadyToSend();
    if (!credentials) return false;
    try {
      await sendMessage(credentials, formatSystemEventMessage(reason, message));
      return true;
    } catch (error) {
      logWarn('Telegram system alert failed:', String(error));
      return false;
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
  const setTelegramAlertsEnabled = async (enabled: boolean, isCurrent: () => boolean = () => true) => {
    if (!enabled) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return { success: true, telegramAlertsEnabled: false };
    }
    const granted = await hasTelegramHostPermission();
    if (!isCurrent())
      return {
        success: false,
        telegramAlertsEnabled: state.appState.telegramAlertsEnabled,
        error: 'Setting changed while permission was pending',
      };
    if (!granted) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return {
        success: false,
        telegramAlertsEnabled: false,
        error: 'Telegram host permission was not granted',
      };
    }
    state.appState.telegramAlertsEnabled = true;
    await options.saveState();
    return { success: true, telegramAlertsEnabled: true };
  };

  const setTelegramCredentials = async (input: {
    botToken?: string;
    chatId?: string;
    clearToken?: boolean;
  }): Promise<{ success: boolean; configured?: boolean; chatId?: string | null; error?: string }> => {
    const existing = await options.loadCredentials();
    const nextToken = input.clearToken
      ? ''
      : typeof input.botToken === 'string' && input.botToken.trim()
        ? input.botToken.trim()
        : (existing?.botToken ?? '');
    const nextChatId =
      typeof input.chatId === 'string' && input.chatId.trim()
        ? input.chatId.trim()
        : (existing?.chatId ?? '');
    if (!nextToken || !nextChatId) {
      if (!nextToken && !nextChatId && !existing) return { success: true, configured: false, chatId: null };
      return { success: false, error: 'Telegram bot token and chat ID are required' };
    }
    if (!isValidBotToken(nextToken)) return { success: false, error: 'Telegram bot token format is invalid' };
    if (!isValidChatId(nextChatId)) return { success: false, error: 'Telegram chat ID format is invalid' };
    const credentials = normalizeTelegramCredentials({ botToken: nextToken, chatId: nextChatId });
    if (!credentials) return { success: false, error: 'Telegram credentials are invalid' };
    if (!(await hasTelegramHostPermission())) {
      return { success: false, error: 'Telegram host permission was not granted' };
    }
    const validation = await validateSetup(credentials);
    if (!validation.success) {
      return { success: false, error: validation.error ?? 'Telegram bot validation failed' };
    }
    await options.saveCredentials(credentials);
    return { success: true, configured: true, chatId: credentials.chatId };
  };

  return {
    hasTelegramHostPermission,
    syncPermissionState,
    notifyClaimedDrops,
    notifySystemEvent,
    validateSetup,
    sendTestAlert,
    setTelegramAlertsEnabled,
    setTelegramCredentials,
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
