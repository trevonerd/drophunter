// Telegram alerts settings: credentials + enable/test handlers.
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState } from '../../types';

interface UseTelegramSettingsArgs {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
}

export function useTelegramSettings({ state, setState }: UseTelegramSettingsArgs) {
  const handleTelegramAlertsToggle = async () => {
    const next = !state.telegramAlertsEnabled;
    const response = await sendRuntimeMessage({
      type: 'SET_TELEGRAM_ALERTS_ENABLED',
      payload: { enabled: next },
    });
    if (!response?.success) {
      return response;
    }
    setState((prev) => ({
      ...prev,
      telegramAlertsEnabled: response.telegramAlertsEnabled ?? next,
    }));
    return response;
  };

  const handleTelegramSystemAlertsToggle = async () => {
    const next = !state.telegramSystemAlertsEnabled;
    const response = await sendRuntimeMessage({
      type: 'SET_TELEGRAM_SYSTEM_ALERTS_ENABLED',
      payload: { enabled: next },
    });
    if (!response?.success) {
      return response;
    }
    setState((prev) => ({
      ...prev,
      telegramSystemAlertsEnabled: response.telegramSystemAlertsEnabled ?? next,
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

  const loadTelegramSettings = useCallback(async () => {
    return sendRuntimeMessage({ type: 'GET_TELEGRAM_SETTINGS' });
  }, []);

  return {
    handleTelegramAlertsToggle,
    handleTelegramSystemAlertsToggle,
    saveTelegramCredentials,
    testTelegramAlerts,
    loadTelegramSettings,
  };
}
