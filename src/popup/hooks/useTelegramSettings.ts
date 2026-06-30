// Telegram alerts settings: credentials + enable/test handlers.
import type { Dispatch, SetStateAction } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState } from '../../types';
import { TELEGRAM_HOST_PERMISSION } from '../constants';

interface UseTelegramSettingsArgs {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
}

export function useTelegramSettings({ state, setState }: UseTelegramSettingsArgs) {
  const handleTelegramAlertsToggle = async () => {
    const next = !state.telegramAlertsEnabled;
    setState((prev) => ({ ...prev, telegramAlertsEnabled: next }));
    if (next) {
      const granted = await browser.permissions.request(TELEGRAM_HOST_PERMISSION).catch(() => false);
      if (!granted) {
        setState((prev) => ({ ...prev, telegramAlertsEnabled: false }));
        return { success: false, error: 'Telegram host permission was not granted' };
      }
    }
    const response = await sendRuntimeMessage({
      type: 'SET_TELEGRAM_ALERTS_ENABLED',
      payload: { enabled: next },
    });
    if (!response?.success) {
      setState((prev) => ({ ...prev, telegramAlertsEnabled: !next }));
      return response;
    }
    setState((prev) => ({
      ...prev,
      telegramAlertsEnabled: response.telegramAlertsEnabled ?? next,
    }));
    return response;
  };

  const saveTelegramCredentials = async (botToken: string, chatId: string) => {
    return sendRuntimeMessage({
      type: 'SET_TELEGRAM_CREDENTIALS',
      payload: { botToken, chatId },
    });
  };

  const testTelegramAlerts = async () => {
    return sendRuntimeMessage({ type: 'TEST_TELEGRAM_ALERTS' });
  };

  const loadTelegramSettings = async () => {
    return sendRuntimeMessage({ type: 'GET_TELEGRAM_SETTINGS' });
  };

  return {
    handleTelegramAlertsToggle,
    saveTelegramCredentials,
    testTelegramAlerts,
    loadTelegramSettings,
  };
}
