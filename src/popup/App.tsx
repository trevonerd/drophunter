import { useCallback, useMemo, useState } from 'react';
import { browser } from '../shared/browser-api.ts';
import { sortPendingDrops } from '../shared/drop-order';
import { getGameDisplayLabel } from '../shared/game-selection';
import { sendRuntimeMessage } from '../shared/messages';
import { deriveRuntimeMode } from '../shared/runtime-status';
import { isExpiredGame } from '../shared/utils';
import type { TwitchGame } from '../types';
import { ClaimLogView } from './components/ClaimLogView';
import { MainView } from './components/MainView';
import { SettingsView } from './components/SettingsView';
import { type CampaignSyncStatus, REWARDS_LOADING_FALLBACK_MS, STALE_THRESHOLD_MS } from './constants';
import { useAppState } from './hooks/useAppState';
import { useDropsRefresh } from './hooks/useDropsRefresh';
import { useOnboarding } from './hooks/useOnboarding';
import { useRecoveryClock } from './hooks/useRecoveryClock';
import { useSettingsToggles } from './hooks/useSettingsToggles';
import { useTelegramSettings } from './hooks/useTelegramSettings';
import { logPopupWarn } from './logging';
import { getGameToStartFromQueue, queueGameIdentity } from './queue-start';

function App() {
  const { state, setState, loading, gamesLoading, rewardsLoading, setRewardsLoading, beginRewardsLoad } =
    useAppState();
  const [actionLoading, setActionLoading] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'main' | 'settings' | 'log'>('main');

  const isStale =
    !state.isRunning &&
    state.availableGames.length > 0 &&
    !gamesLoading &&
    Date.now() - (state.lastSuccessfulRefreshAt ?? 0) > STALE_THRESHOLD_MS;

  const { dropsRefreshLoading, activeSyncError, openDropsPage } = useDropsRefresh({
    state,
    setState,
    setQueueMessage,
    isStale,
  });

  const {
    onboardingCompleted,
    setOnboardingCompleted,
    onboardingStep,
    setOnboardingStep,
    firstSyncConfirmation,
    setFirstSyncConfirmation,
    firstSyncCampaignCount,
    setFirstSyncCampaignCount,
  } = useOnboarding(state);

  const pendingDrops = useMemo(() => sortPendingDrops(state.pendingDrops), [state.pendingDrops]);
  const completedDrops = state.completedDrops;
  const claimableCount = useMemo(
    () => state.pendingDrops.filter((d) => d.claimable && d.dropType !== 'event-based').length,
    [state.pendingDrops],
  );
  const sortedGames = useMemo(
    () =>
      [...state.availableGames]
        .filter((g) => !isExpiredGame(g))
        .sort((a, b) => getGameDisplayLabel(a).localeCompare(getGameDisplayLabel(b))),
    [state.availableGames],
  );
  const queueGames = useMemo(() => {
    const fallbackByCampaignId = new Map(
      sortedGames.filter((g) => g.campaignId).map((g) => [g.campaignId, g]),
    );
    const fallbackById = new Map(sortedGames.filter((g) => !g.campaignId).map((g) => [g.id, g]));
    return state.queue.map((q) =>
      q.campaignId ? (fallbackByCampaignId.get(q.campaignId) ?? q) : (fallbackById.get(q.id) ?? q),
    );
  }, [state.queue, sortedGames]);
  const campaignSyncStatus: CampaignSyncStatus = dropsRefreshLoading
    ? 'syncing'
    : activeSyncError
      ? 'failed'
      : !gamesLoading && state.availableGames.length === 0
        ? 'empty'
        : isStale
          ? 'syncing'
          : 'fresh';
  const runtimeMode = deriveRuntimeMode(state);
  const recoveryNow = useRecoveryClock(runtimeMode);

  const {
    handleMonitorAutoOpenToggle,
    handleAutoResumeOnStartupToggle,
    handleAutoClaimChannelPointsBonusToggle,
    handleAutoClaimDropsToggle,
    handleMuteFarmingTabToggle,
    handleNotificationsEnabledToggle,
    handleStreamerSelectionModeChange,
    handlePreferredStreamerLanguageChange,
  } = useSettingsToggles({ state, setState });

  const { handleTelegramAlertsToggle, saveTelegramCredentials, testTelegramAlerts, loadTelegramSettings } =
    useTelegramSettings({ state, setState });

  const handleGameSelect = async (gameId: string) => {
    const selected = sortedGames.find((g) => queueGameIdentity(g) === gameId);
    if (selected) {
      setState((prev) => ({
        ...prev,
        selectedGame: selected,
        pendingDrops: [],
        completedDrops: [],
        currentDrop: null,
        completionNotified: false,
      }));
      setQueueMessage(null);
      setFirstSyncConfirmation(false);
      setFirstSyncCampaignCount(null);
      if (onboardingStep === 'selector') {
        setOnboardingStep('start');
      }
      beginRewardsLoad(queueGameIdentity(selected));
      try {
        await sendRuntimeMessage({ type: 'SET_SELECTED_GAME', payload: { game: selected } }).catch(
          (err: unknown) => logPopupWarn('SET_SELECTED_GAME failed:', err),
        );
      } finally {
        // Loader cleared by UPDATE_STATE broadcast in useAppState once background
        // projects drops for the new game. This is only a safety net.
        setTimeout(() => setRewardsLoading(false), REWARDS_LOADING_FALLBACK_MS);
      }
    }
  };

  const handleAddToQueue = async () => {
    if (!state.selectedGame || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await sendRuntimeMessage({
        type: 'ADD_TO_QUEUE',
        payload: { game: state.selectedGame },
      });
      if (!response?.success) {
        setQueueMessage('Unable to add campaign to queue.');
        return;
      }
      if (response.added) {
        setQueueMessage(`Added "${getGameDisplayLabel(state.selectedGame)}" to queue.`);
        return;
      }
      if (response.reason === 'already-completed') {
        setQueueMessage(`"${getGameDisplayLabel(state.selectedGame)}" already has all rewards completed.`);
        return;
      }
      if (response.reason === 'already-queued') {
        setQueueMessage(`"${getGameDisplayLabel(state.selectedGame)}" is already in queue.`);
        return;
      }
      setQueueMessage(`"${getGameDisplayLabel(state.selectedGame)}" was not added to queue.`);
    } catch {
      setQueueMessage('Queue add failed.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleRemoveFromQueue = async (game: TwitchGame) => {
    try {
      await sendRuntimeMessage({ type: 'REMOVE_FROM_QUEUE', payload: { game } });
    } catch (err: unknown) {
      logPopupWarn('REMOVE_FROM_QUEUE failed:', err);
      setQueueMessage('Unable to remove campaign from queue.');
    }
  };

  const handleClearQueue = async () => {
    try {
      await sendRuntimeMessage({ type: 'CLEAR_QUEUE' });
      setQueueMessage('Queue cleared.');
    } catch (err: unknown) {
      logPopupWarn('CLEAR_QUEUE failed:', err);
      setQueueMessage('Unable to clear queue.');
    }
  };

  const handleReorderQueue = async (fromIndex: number, toIndex: number) => {
    try {
      const response = await sendRuntimeMessage({
        type: 'REORDER_QUEUE',
        payload: { fromIndex, toIndex },
      });
      if (!response?.success) {
        setQueueMessage(response?.error ?? 'Unable to reorder queue.');
      }
    } catch (err: unknown) {
      logPopupWarn('REORDER_QUEUE failed:', err);
      setQueueMessage('Unable to reorder queue.');
    }
  };

  const withAction = useCallback(
    async (action: () => Promise<void>) => {
      if (actionLoading) return;
      setActionLoading(true);
      try {
        await action();
      } finally {
        setTimeout(() => setActionLoading(false), 250);
      }
    },
    [actionLoading],
  );

  const handleStart = () =>
    withAction(async () => {
      const gameToStart = getGameToStartFromQueue(state.selectedGame, queueGames);
      if (!gameToStart) {
        setQueueMessage('Select a campaign to start farming.');
        return;
      }
      const response = await sendRuntimeMessage({
        type: 'START_FARMING',
        payload: { game: gameToStart },
      });
      if (response && !response.success && response.error) {
        setQueueMessage(response.error);
        return;
      }
      if (response?.success && !onboardingCompleted) {
        setOnboardingCompleted(true);
        setOnboardingStep(null);
        await browser.storage.local.set({ onboardingCompleted: true }).catch(() => {});
      }
    });

  const handlePause = useCallback(
    () =>
      withAction(async () => {
        await sendRuntimeMessage({ type: 'PAUSE_FARMING' });
      }),
    [withAction],
  );

  const handleResume = useCallback(
    () =>
      withAction(async () => {
        await sendRuntimeMessage({ type: 'RESUME_FARMING' });
      }),
    [withAction],
  );

  const handleStop = useCallback(
    () =>
      withAction(async () => {
        await sendRuntimeMessage({ type: 'STOP_FARMING' });
      }),
    [withAction],
  );

  const openMiniDashboard = async () => {
    await sendRuntimeMessage({ type: 'OPEN_MONITOR_DASHBOARD', payload: { toggle: true } }).catch(
      (err: unknown) => logPopupWarn('OPEN_MONITOR_DASHBOARD failed:', err),
    );
  };

  if (loading) {
    return (
      <div
        className="dh-view flex items-center justify-center py-12 text-[color:var(--dh-text-soft)]"
        role="status"
        aria-live="polite"
      >
        <div className="spinner rounded-full h-8 w-8 border-[3px] border-twitch-purple border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="dh-view w-[400px] text-[color:var(--dh-text)]">
      {activeView === 'log' ? (
        <ClaimLogView onBack={() => setActiveView('settings')} />
      ) : activeView === 'settings' ? (
        <SettingsView
          state={state}
          onBack={() => setActiveView('main')}
          onOpenClaimLog={() => setActiveView('log')}
          onMonitorAutoOpenToggle={() => void handleMonitorAutoOpenToggle()}
          onMuteFarmingTabToggle={() => void handleMuteFarmingTabToggle()}
          onNotificationsEnabledToggle={() => void handleNotificationsEnabledToggle()}
          onTelegramAlertsToggle={handleTelegramAlertsToggle}
          onSaveTelegramCredentials={saveTelegramCredentials}
          onTestTelegramAlerts={testTelegramAlerts}
          onLoadTelegramSettings={loadTelegramSettings}
          onAutoResumeOnStartupToggle={() => void handleAutoResumeOnStartupToggle()}
          onAutoClaimChannelPointsBonusToggle={() => void handleAutoClaimChannelPointsBonusToggle()}
          onAutoClaimDropsToggle={() => void handleAutoClaimDropsToggle()}
          onStreamerSelectionModeChange={(mode) => void handleStreamerSelectionModeChange(mode)}
          onPreferredStreamerLanguageChange={(language) =>
            void handlePreferredStreamerLanguageChange(language)
          }
        />
      ) : (
        <MainView
          state={state}
          actionLoading={actionLoading}
          dropsRefreshLoading={dropsRefreshLoading}
          campaignSyncStatus={campaignSyncStatus}
          activeSyncError={activeSyncError}
          sortedGames={sortedGames}
          queueGames={queueGames}
          pendingDrops={pendingDrops}
          completedDrops={completedDrops}
          claimableCount={claimableCount}
          runtimeMode={runtimeMode}
          recoveryNow={recoveryNow}
          onboardingStep={onboardingStep}
          firstSyncConfirmation={firstSyncConfirmation}
          firstSyncCampaignCount={firstSyncCampaignCount}
          queueMessage={queueMessage}
          rewardsLoading={rewardsLoading}
          onMuteToggle={() => void handleMuteFarmingTabToggle()}
          onOpenDropsPage={() => void openDropsPage()}
          onOpenMonitor={openMiniDashboard}
          onOpenSettings={() => setActiveView('settings')}
          onNotificationsToggle={() => void handleNotificationsEnabledToggle()}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onRefreshCampaigns={() => void openDropsPage()}
          onSelectGame={(gameId) => void handleGameSelect(gameId)}
          onAddToQueue={() => void handleAddToQueue()}
          onRemoveFromQueue={(game) => void handleRemoveFromQueue(game)}
          onClearQueue={() => void handleClearQueue()}
          onReorderQueue={(fromIndex, toIndex) => void handleReorderQueue(fromIndex, toIndex)}
          onStart={handleStart}
        />
      )}
    </div>
  );
}

export default App;
