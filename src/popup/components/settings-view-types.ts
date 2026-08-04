import type { AppState, FarmCategoryScope, StreamerSelectionMode, WatchTransportMode } from '../../types';

export interface SettingsViewProps {
  state: AppState;
  onBack: () => void;
  onOpenClaimLog: () => void;
  onMonitorAutoOpenToggle: () => void;
  onMuteFarmingTabToggle: () => void;
  onNotificationsEnabledToggle: () => void;
  notificationPermissionDenied?: boolean;
  onTelegramAlertsToggle: () => Promise<{ success: boolean; error?: string } | undefined>;
  onSaveTelegramCredentials: (
    botToken: string,
    chatId: string,
  ) => Promise<
    { success: boolean; configured?: boolean; chatId?: string | null; error?: string } | undefined
  >;
  onTestTelegramAlerts: () => Promise<{ success: boolean; error?: string } | undefined>;
  onLoadTelegramSettings: () => Promise<
    { success: boolean; configured?: boolean; chatId?: string | null; error?: string } | undefined
  >;
  onAutoResumeOnStartupToggle: () => void;
  onAutoClaimChannelPointsBonusToggle: () => void;
  onAutoClaimDropsToggle: () => void;
  onStreamerSelectionModeChange: (mode: StreamerSelectionMode) => void;
  onPreferredStreamerLanguageChange: (language: string) => void;
  onAutoStartFavoriteGamesToggle?: () => void | Promise<void>;
  onFarmCategoryScopeChange?: (scope: FarmCategoryScope) => void;
  onWatchTransportModeChange?: (mode: WatchTransportMode) => void;
  favoriteGamesCount?: number;
}
