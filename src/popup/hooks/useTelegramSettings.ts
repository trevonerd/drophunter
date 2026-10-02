// Telegram alerts settings: credentials + enable/test handlers.
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState } from '../../types';
import { TELEGRAM_HOST_PERMISSION } from '../constants';

interface UseTelegramSettingsArgs {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
}

async function requestTelegramPermission() {
  // Request before any await so Chrome still sees the popup's user gesture.
  const granted = await browser.permissions.request(TELEGRAM_HOST_PERMISSION).catch(() => false);
  return granted ? null : { success: false as const, error: 'Telegram host permission was not granted' };
}

export function useTelegramSettings({ state, setState }: UseTelegramSettingsArgs) {
  const handleTelegramAlertsToggle = async () => {
    const next = !state.telegramAlertsEnabled;
    if (next) {
      const error = await requestTelegramPermission();
      if (error) return error;
    }
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
    const error = await requestTelegramPermission();
    if (error) return error;
    return sendRuntimeMessage({
      type: 'SET_TELEGRAM_CREDENTIALS',
      payload: { botToken, chatId },
    });
  };

  const testTelegramAlerts = async () => {
    const error = await requestTelegramPermission();
    if (error) return error;
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
