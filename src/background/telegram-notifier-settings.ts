import {
  isValidBotToken,
  isValidChatId,
  normalizeTelegramCredentials,
  type TelegramCredentials,
  type TelegramNotifierOptions,
  type TelegramNotifierState,
} from './telegram-notification-core.ts';

interface TelegramSettingsDependencies {
  hasPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  validateSetup: (credentials: TelegramCredentials) => Promise<{ success: boolean; error?: string }>;
}

export function createTelegramNotifierSettings(
  state: TelegramNotifierState,
  options: TelegramNotifierOptions,
  deps: TelegramSettingsDependencies,
) {
  const setTelegramAlertsEnabled = async (enabled: boolean) => {
    if (!enabled) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return { success: true, telegramAlertsEnabled: false };
    }
    const credentials = await options.loadCredentials();
    if (!credentials) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return {
        success: false,
        telegramAlertsEnabled: false,
        error: 'Telegram bot token and chat ID are required',
      };
    }
    if (!(await deps.hasPermission()) && !(await deps.requestPermission())) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return {
        success: false,
        telegramAlertsEnabled: false,
        error: 'Telegram host permission was not granted',
      };
    }
    const validation = await deps.validateSetup(credentials);
    if (!validation.success) {
      state.appState.telegramAlertsEnabled = false;
      await options.saveState();
      return {
        success: false,
        telegramAlertsEnabled: false,
        error: validation.error ?? 'Telegram bot validation failed',
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
    if (!(await deps.hasPermission()) && !(await deps.requestPermission())) {
      return { success: false, error: 'Telegram host permission was not granted' };
    }
    const validation = await deps.validateSetup(credentials);
    if (!validation.success) {
      return { success: false, error: validation.error ?? 'Telegram bot validation failed' };
    }
    await options.saveCredentials(credentials);
    return { success: true, configured: true, chatId: credentials.chatId };
  };

  return { setTelegramAlertsEnabled, setTelegramCredentials };
}
