// Extracted from src/popup/App.tsx (settings toggle + select handlers).
import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState, FarmCategoryScope, StreamerSelectionMode, WatchTransportMode } from '../../types';
import { NOTIFICATION_PERMISSION } from '../constants';
import { createSettingsTransactionCoordinator } from '../settings-transaction.ts';

interface UseSettingsTogglesArgs {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
}

export function useSettingsToggles({ state, setState }: UseSettingsTogglesArgs) {
  const [notificationPermissionDenied, setNotificationPermissionDenied] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const transactionRef = useRef<ReturnType<typeof createSettingsTransactionCoordinator> | null>(null);
  if (transactionRef.current === null) {
    transactionRef.current = createSettingsTransactionCoordinator({
      read: (key) => stateRef.current[key],
      write: (key, value) => {
        stateRef.current = { ...stateRef.current, [key]: value };
        setState((previous) => ({ ...previous, [key]: value }));
      },
      patch: (values) => {
        stateRef.current = { ...stateRef.current, ...values };
        setState((previous) => ({ ...previous, ...values }));
      },
    });
  }
  const transactions = transactionRef.current;

  type BooleanSettingKey =
    | 'monitorAutoOpen'
    | 'autoResumeOnStartup'
    | 'muteFarmingTab'
    | 'autoClaimChannelPointsBonus'
    | 'autoClaimDrops';

  const makeToggleHandler =
    <Response extends { readonly success: boolean }>(
      stateKey: BooleanSettingKey,
      send: (enabled: boolean) => Promise<Response | undefined>,
      successPatch: (response: Response, next: boolean) => Partial<AppState>,
    ) =>
    async () => {
      const next = !stateRef.current[stateKey];
      await transactions.run({
        key: stateKey,
        next,
        send: () => send(next),
        successPatch: (response) => successPatch(response, next),
      });
    };

  const handleMonitorAutoOpenToggle = makeToggleHandler(
    'monitorAutoOpen',
    (enabled) => sendRuntimeMessage({ type: 'SET_MONITOR_AUTO_OPEN', payload: { enabled } }),
    (response, next) => ({ monitorAutoOpen: response.monitorAutoOpen ?? next }),
  );

  const handleAutoResumeOnStartupToggle = makeToggleHandler(
    'autoResumeOnStartup',
    (enabled) => sendRuntimeMessage({ type: 'SET_AUTO_RESUME_ON_STARTUP', payload: { enabled } }),
    (response, next) => ({ autoResumeOnStartup: response.autoResumeOnStartup ?? next }),
  );

  const handleAutoClaimChannelPointsBonusToggle = makeToggleHandler(
    'autoClaimChannelPointsBonus',
    (enabled) => sendRuntimeMessage({ type: 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS', payload: { enabled } }),
    (response, next) => ({
      autoClaimChannelPointsBonus: response.autoClaimChannelPointsBonus ?? next,
    }),
  );

  const handleAutoClaimDropsToggle = makeToggleHandler(
    'autoClaimDrops',
    (enabled) => sendRuntimeMessage({ type: 'SET_AUTO_CLAIM_DROPS', payload: { enabled } }),
    (response, next) => ({ autoClaimDrops: response.autoClaimDrops ?? next }),
  );

  const handleMuteFarmingTabToggle = makeToggleHandler(
    'muteFarmingTab',
    (enabled) => sendRuntimeMessage({ type: 'SET_MUTE_FARMING_TAB', payload: { enabled } }),
    (response, next) => ({ muteFarmingTab: response.muteFarmingTab ?? next }),
  );

  const handleNotificationsEnabledToggle = async () => {
    const next = !stateRef.current.notificationsEnabled;
    setNotificationPermissionDenied(false);
    const result = await transactions.run({
      key: 'notificationsEnabled',
      next,
      authorize: next
        ? () => browser.permissions.request(NOTIFICATION_PERMISSION).catch(() => false)
        : undefined,
      send: () =>
        sendRuntimeMessage({
          type: 'SET_NOTIFICATIONS_ENABLED',
          payload: { enabled: next },
        }),
      successPatch: (response) => ({
        notificationsEnabled: response.notificationsEnabled ?? next,
      }),
    });
    if (result.kind === 'rejected' && result.reason === 'permission') {
      setNotificationPermissionDenied(true);
    }
  };

  const handleAutoStartFavoriteGamesToggle = async () => {
    const next = !stateRef.current.autoStartFavoriteGames;
    setNotificationPermissionDenied(false);
    const result = await transactions.run({
      key: 'autoStartFavoriteGames',
      next,
      authorize: next
        ? () => browser.permissions.request(NOTIFICATION_PERMISSION).catch(() => false)
        : undefined,
      send: () =>
        sendRuntimeMessage({
          type: 'SET_AUTO_START_FAVORITES',
          payload: { enabled: next },
        }),
      successPatch: (response) => ({
        autoStartFavoriteGames: response.autoStartFavoriteGames ?? next,
        notificationsEnabled: next ? true : stateRef.current.notificationsEnabled,
      }),
    });
    if (result.kind === 'rejected') {
      setNotificationPermissionDenied(next);
    }
  };

  const handleFarmCategoryScopeChange = async (scope: FarmCategoryScope) => {
    await transactions.run({
      key: 'farmCategoryScope',
      next: scope,
      send: () =>
        sendRuntimeMessage({
          type: 'SET_FARM_CATEGORY_SCOPE',
          payload: { scope },
        }),
      successPatch: (response) => ({ farmCategoryScope: response.farmCategoryScope ?? scope }),
    });
  };

  const handleWatchTransportModeChange = async (mode: WatchTransportMode) => {
    await transactions.run({
      key: 'watchTransportPreference',
      next: mode,
      send: () =>
        sendRuntimeMessage({
          type: 'SET_WATCH_TRANSPORT_MODE',
          payload: { mode },
        }),
      successPatch: (response) => ({
        watchTransportPreference: response.watchTransportPreference ?? mode,
      }),
    });
  };

  const handleStreamerSelectionModeChange = async (mode: StreamerSelectionMode) => {
    await transactions.run({
      key: 'streamerSelectionMode',
      next: mode,
      send: () =>
        sendRuntimeMessage({
          type: 'SET_STREAMER_SELECTION_MODE',
          payload: { mode },
        }),
      successPatch: (response) => ({ streamerSelectionMode: response.streamerSelectionMode ?? mode }),
    });
  };

  const handlePreferredStreamerLanguageChange = async (language: string) => {
    const next = language || null;
    await transactions.run({
      key: 'preferredStreamerLanguage',
      next,
      send: () =>
        sendRuntimeMessage({
          type: 'SET_PREFERRED_STREAMER_LANGUAGE',
          payload: { language: next },
        }),
      successPatch: (response) => ({
        preferredStreamerLanguage: response.preferredStreamerLanguage ?? next,
      }),
    });
  };

  return {
    handleMonitorAutoOpenToggle,
    handleAutoResumeOnStartupToggle,
    handleAutoClaimChannelPointsBonusToggle,
    handleAutoClaimDropsToggle,
    handleMuteFarmingTabToggle,
    handleNotificationsEnabledToggle,
    handleAutoStartFavoriteGamesToggle,
    handleFarmCategoryScopeChange,
    handleWatchTransportModeChange,
    notificationPermissionDenied,
    handleStreamerSelectionModeChange,
    handlePreferredStreamerLanguageChange,
  };
}
