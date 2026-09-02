import { useRef, useState } from 'react';
import { sendRuntimeMessage } from '../shared/messages';
import { deriveRuntimeMode } from '../shared/runtime-status';
import type { GamePreference } from '../types';
import { PopupView, type PopupViewName } from './components/PopupView';
import { deriveCampaignSyncStatus, STALE_THRESHOLD_MS } from './constants';
import { useAppState } from './hooks/useAppState';
import { useDropsRefresh } from './hooks/useDropsRefresh';
import { useOnboarding } from './hooks/useOnboarding';
import { usePopupActions } from './hooks/usePopupActions';
import { useRecoveryClock } from './hooks/useRecoveryClock';
import { useSettingsToggles } from './hooks/useSettingsToggles';
import { useSortedPopupGames } from './hooks/useSortedPopupGames';
import { useTelegramSettings } from './hooks/useTelegramSettings';
import { logPopupWarn } from './logging';

async function openMiniDashboard() {
  await sendRuntimeMessage({ type: 'OPEN_MONITOR_DASHBOARD', payload: { toggle: true } }).catch(
    (error: unknown) => logPopupWarn('OPEN_MONITOR_DASHBOARD failed:', error),
  );
}

function App() {
  const { state, setState, loading, gamesLoading } = useAppState();
  const [activeView, setActiveView] = useState<PopupViewName>('main');
  const viewContainerRef = useRef<HTMLDivElement>(null);
  const isStale =
    !state.isRunning &&
    state.availableGames.length > 0 &&
    !gamesLoading &&
    Date.now() - (state.lastSuccessfulRefreshAt ?? 0) > STALE_THRESHOLD_MS;
  const onboarding = useOnboarding(state);
  const { pendingDrops, completedDrops, sortedGames, queueGames } = useSortedPopupGames(state);
  const actions = usePopupActions({
    state,
    setState,
    queueGames,
    hasCompletedOnboarding: onboarding.onboardingCompleted,
    setOnboardingCompleted: onboarding.setOnboardingCompleted,
    onboardingStep: onboarding.onboardingStep,
    setOnboardingStep: onboarding.setOnboardingStep,
  });
  const { dropsRefreshLoading, activeSyncError, manualRefreshCampaignCount, openDropsPage } = useDropsRefresh(
    {
      state,
      setState,
      setQueueMessage: actions.setQueueMessage,
      isStale,
    },
  );
  const settings = useSettingsToggles({ state, setState });
  const telegram = useTelegramSettings({ state, setState });
  const runtimeMode = deriveRuntimeMode(state);
  const recoveryNow = useRecoveryClock(runtimeMode);
  const campaignSyncStatus = deriveCampaignSyncStatus({
    dropsRefreshLoading,
    activeSyncError,
    gamesLoading,
    availableCampaignCount: state.availableGames.length,
    twitchSessionDetected: state.twitchSessionDetected,
    isStale,
    campaignSyncState: state.campaignSyncState,
    twitchSessionSyncState: state.twitchSessionSyncState,
    isRunning: state.isRunning,
  });

  return (
    <PopupView
      loading={loading}
      activeView={activeView}
      setActiveView={setActiveView}
      viewContainerRef={viewContainerRef}
      openDropsPage={openDropsPage}
      mainViewProps={{
        state,
        actionLoading: actions.actionLoading,
        dropsRefreshLoading,
        campaignSyncStatus,
        activeSyncError,
        sortedGames,
        queueGames,
        pendingDrops,
        completedDrops,
        runtimeMode,
        recoveryNow,
        onboardingStep: onboarding.onboardingStep,
        firstSyncConfirmation: onboarding.firstSyncConfirmation || manualRefreshCampaignCount !== null,
        firstSyncCampaignCount: manualRefreshCampaignCount ?? onboarding.firstSyncCampaignCount,
        queueMessage: actions.queueMessage,
        notificationPermissionDenied: settings.notificationPermissionDenied,
        onAutoStartFavoriteGamesToggle: () => void settings.handleAutoStartFavoriteGamesToggle(),
        onMuteToggle: () => void settings.handleMuteFarmingTabToggle(),
        onOpenMonitor: openMiniDashboard,
        onPause: actions.handlePause,
        onResume: actions.handleResume,
        onStop: actions.handleStop,
        onAddToQueue: (game) => void actions.handleAddToQueue(game ?? state.selectedGame),
        onAddAllToQueue: (games) => void actions.handleAddAllToQueue(games),
        onLinkAccount: actions.handleLinkAccount,
        onSetGamePreference: (game, preference: GamePreference) =>
          actions.handleSetGamePreference(game, preference),
        onRemoveFromQueue: (game) => void actions.handleRemoveFromQueue(game),
        onClearQueue: () => void actions.handleClearQueue(),
        onReorderQueue: (fromIndex, toIndex) => void actions.handleReorderQueue(fromIndex, toIndex),
        onStart: actions.handleStart,
      }}
      settingsViewProps={{
        state,
        onMonitorAutoOpenToggle: () => void settings.handleMonitorAutoOpenToggle(),
        onMuteFarmingTabToggle: () => void settings.handleMuteFarmingTabToggle(),
        onNotificationsEnabledToggle: () => void settings.handleNotificationsEnabledToggle(),
        notificationPermissionDenied: settings.notificationPermissionDenied,
        onTelegramAlertsToggle: telegram.handleTelegramAlertsToggle,
        onTelegramSystemAlertsToggle: telegram.handleTelegramSystemAlertsToggle,
        onSaveTelegramCredentials: telegram.saveTelegramCredentials,
        onTestTelegramAlerts: telegram.testTelegramAlerts,
        onLoadTelegramSettings: telegram.loadTelegramSettings,
        onFarmCategoryScopeChange: (scope) => void settings.handleFarmCategoryScopeChange(scope),
        onWatchTransportModeChange: (mode) => void settings.handleWatchTransportModeChange(mode),
        onAutoClaimChannelPointsBonusToggle: () => void settings.handleAutoClaimChannelPointsBonusToggle(),
        onAutoClaimDropsToggle: () => void settings.handleAutoClaimDropsToggle(),
        onStreamerSelectionModeChange: (mode) => void settings.handleStreamerSelectionModeChange(mode),
        onPreferredStreamerLanguageChange: (language) =>
          void settings.handlePreferredStreamerLanguageChange(language),
      }}
    />
  );
}

export default App;
