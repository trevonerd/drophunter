// Extracted from src/popup/App.tsx (settings toggle + select handlers).
import { type Dispatch, type SetStateAction, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState, StreamerSelectionMode } from '../../types';
import { NOTIFICATION_PERMISSION } from '../constants';

interface UseSettingsTogglesArgs {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
}

export function useSettingsToggles({ state, setState }: UseSettingsTogglesArgs) {
  const [notificationPermissionDenied, setNotificationPermissionDenied] = useState(false);

  const makeToggleHandler =
    (
      stateKey:
        | 'monitorAutoOpen'
        | 'autoResumeOnStartup'
        | 'muteFarmingTab'
        | 'autoClaimChannelPointsBonus'
        | 'autoClaimDrops',
      send: (enabled: boolean) => Promise<{ success: boolean; [key: string]: unknown } | undefined>,
    ) =>
    async () => {
      const next = !state[stateKey];
      setState((prev) => ({ ...prev, [stateKey]: next }));
      const response = await send(next);
      if (!response?.success) {
        setState((prev) => ({ ...prev, [stateKey]: !next }));
        return;
      }
      setState((prev) => ({ ...prev, [stateKey]: (response[stateKey] as boolean | undefined) ?? next }));
    };

  const handleMonitorAutoOpenToggle = makeToggleHandler('monitorAutoOpen', (enabled) =>
    sendRuntimeMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled } }),
  );

  const handleAutoResumeOnStartupToggle = makeToggleHandler('autoResumeOnStartup', (enabled) =>
    sendRuntimeMessage({ type: 'SET_AUTO_RESUME_ON_STARTUP', payload: { enabled } }),
  );

  const handleAutoClaimChannelPointsBonusToggle = makeToggleHandler(
    'autoClaimChannelPointsBonus',
    (enabled) => sendRuntimeMessage({ type: 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS', payload: { enabled } }),
  );

  const handleAutoClaimDropsToggle = makeToggleHandler('autoClaimDrops', (enabled) =>
    sendRuntimeMessage({ type: 'SET_AUTO_CLAIM_DROPS', payload: { enabled } }),
  );

  const handleMuteFarmingTabToggle = makeToggleHandler('muteFarmingTab', (enabled) =>
    sendRuntimeMessage({ type: 'SET_MUTE_FARMING_TAB', payload: { enabled } }),
  );

  const handleNotificationsEnabledToggle = async () => {
    const next = !state.notificationsEnabled;
    setNotificationPermissionDenied(false);
    setState((prev) => ({ ...prev, notificationsEnabled: next }));
    if (next) {
      const granted = await browser.permissions.request(NOTIFICATION_PERMISSION).catch(() => false);
      if (!granted) {
        setState((prev) => ({ ...prev, notificationsEnabled: false }));
        setNotificationPermissionDenied(true);
        return;
      }
    }
    const response = await sendRuntimeMessage({
      type: 'SET_NOTIFICATIONS_ENABLED',
      payload: { enabled: next },
    });
    if (!response?.success) {
      setState((prev) => ({ ...prev, notificationsEnabled: !next }));
      return;
    }
    setState((prev) => ({
      ...prev,
      notificationsEnabled: response.notificationsEnabled ?? next,
    }));
  };

  const handleStreamerSelectionModeChange = async (mode: StreamerSelectionMode) => {
    const previous = state.streamerSelectionMode;
    setState((prev) => ({ ...prev, streamerSelectionMode: mode }));
    const response = await sendRuntimeMessage({
      type: 'SET_STREAMER_SELECTION_MODE',
      payload: { mode },
    });
    if (!response?.success) {
      setState((prev) => ({ ...prev, streamerSelectionMode: previous }));
      return;
    }
    setState((prev) => ({
      ...prev,
      streamerSelectionMode: response.streamerSelectionMode ?? mode,
    }));
  };

  const handlePreferredStreamerLanguageChange = async (language: string) => {
    const next = language || null;
    const previous = state.preferredStreamerLanguage;
    setState((prev) => ({ ...prev, preferredStreamerLanguage: next }));
    const response = await sendRuntimeMessage({
      type: 'SET_PREFERRED_STREAMER_LANGUAGE',
      payload: { language: next },
    });
    if (!response?.success) {
      setState((prev) => ({ ...prev, preferredStreamerLanguage: previous ?? null }));
      return;
    }
    setState((prev) => ({
      ...prev,
      preferredStreamerLanguage: response.preferredStreamerLanguage ?? next,
    }));
  };

  return {
    handleMonitorAutoOpenToggle,
    handleAutoResumeOnStartupToggle,
    handleAutoClaimChannelPointsBonusToggle,
    handleAutoClaimDropsToggle,
    handleMuteFarmingTabToggle,
    handleNotificationsEnabledToggle,
    notificationPermissionDenied,
    handleStreamerSelectionModeChange,
    handlePreferredStreamerLanguageChange,
  };
}
