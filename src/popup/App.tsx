import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '../shared/browser-api.ts';
import { sortPendingDrops } from '../shared/drop-order';
import {
  dropMatchesGame,
  favoriteGameIdentityKeys,
  gameCategoryIdentityKeys,
  gameCategoryKey,
  gameKey,
  getGameDisplayLabel,
  isFavoriteGame,
} from '../shared/game-selection';
import { sendRuntimeMessage } from '../shared/messages';
import { deriveRuntimeMode } from '../shared/runtime-status';
import { isExpiredGame } from '../shared/utils';
import type { TwitchGame } from '../types';
import { ClaimLogView } from './components/ClaimLogView';
import { MainView } from './components/MainView';
import { SettingsView } from './components/SettingsView';
import { deriveCampaignSyncStatus, STALE_THRESHOLD_MS } from './constants';
import { formatFarmingCompleteQueueMessage } from './format';
import { useAppState } from './hooks/useAppState';
import { useDropsRefresh } from './hooks/useDropsRefresh';
import { useOnboarding } from './hooks/useOnboarding';
import { useRecoveryClock } from './hooks/useRecoveryClock';
import { useSettingsToggles } from './hooks/useSettingsToggles';
import { useTelegramSettings } from './hooks/useTelegramSettings';
import { logPopupWarn } from './logging';
import { getGameToStartFromQueue } from './queue-start';

async function openMiniDashboard() {
  await sendRuntimeMessage({ type: 'OPEN_MONITOR_DASHBOARD', payload: { toggle: true } }).catch(
    (err: unknown) => logPopupWarn('OPEN_MONITOR_DASHBOARD failed:', err),
  );
}

function App() {
  const { state, setState, loading, gamesLoading } = useAppState();
  const [actionLoading, setActionLoading] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'main' | 'settings' | 'log'>('main');
  const viewContainerRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeView triggers refocus but isn't read in the body
  useEffect(() => {
    viewContainerRef.current?.focus();
  }, [activeView]);

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
    firstSyncCampaignCount,
  } = useOnboarding(state);

  const pendingDrops = useMemo(() => sortPendingDrops(state.pendingDrops), [state.pendingDrops]);
  const completedDrops = state.completedDrops;
  const sortedGames = useMemo(() => {
    const active = state.availableGames.filter((game) => !isExpiredGame(game));
    const campaignCatalogDrops = Object.values(state.campaignDropsByKey).flat();
    const priorityDrops = campaignCatalogDrops.length > 0 ? campaignCatalogDrops : state.allDrops;
    const queueIndex = new Map(state.queue.map((game, index) => [gameKey(game), index]));
    const expiry = (game: TwitchGame) => {
      const parsed = game.endsAt ? Date.parse(game.endsAt) : Number.POSITIVE_INFINITY;
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };
    const started = (game: TwitchGame) =>
      priorityDrops.some((drop) => dropMatchesGame(drop, game) && drop.progress > 0 && !drop.claimed);
    const availability = (game: TwitchGame) =>
      state.campaignAvailabilityByKey[gameKey(game)]?.eligibleStreamerCount ?? Number.POSITIVE_INFINITY;
    return [...active].sort((left, right) => {
      if (state.campaignPriorityMode === 'priority-list-only') {
        const leftIndex = queueIndex.get(gameKey(left)) ?? Number.POSITIVE_INFINITY;
        const rightIndex = queueIndex.get(gameKey(right)) ?? Number.POSITIVE_INFINITY;
        return leftIndex - rightIndex || getGameDisplayLabel(left).localeCompare(getGameDisplayLabel(right));
      }
      if (state.campaignPriorityMode === 'lowest-availability') {
        return (
          availability(left) - availability(right) ||
          expiry(left) - expiry(right) ||
          Number(started(right)) - Number(started(left)) ||
          (left.campaignId ?? left.id).localeCompare(right.campaignId ?? right.id)
        );
      }
      return (
        expiry(left) - expiry(right) ||
        Number(started(right)) - Number(started(left)) ||
        availability(left) - availability(right) ||
        (left.campaignId ?? left.id).localeCompare(right.campaignId ?? right.id)
      );
    });
  }, [
    state.allDrops,
    state.availableGames,
    state.campaignAvailabilityByKey,
    state.campaignDropsByKey,
    state.campaignPriorityMode,
    state.queue,
  ]);
  const queueGames = useMemo(() => {
    const fallbackByCampaignId = new Map(
      sortedGames.filter((g) => g.campaignId).map((g) => [g.campaignId, g]),
    );
    const fallbackById = new Map(sortedGames.filter((g) => !g.campaignId).map((g) => [g.id, g]));
    return state.queue.map((q) =>
      q.campaignId ? (fallbackByCampaignId.get(q.campaignId) ?? q) : (fallbackById.get(q.id) ?? q),
    );
  }, [state.queue, sortedGames]);
  const campaignSyncStatus = deriveCampaignSyncStatus({
    dropsRefreshLoading,
    activeSyncError,
    gamesLoading,
    availableCampaignCount: state.availableGames.length,
    twitchSessionDetected: state.twitchSessionDetected,
    isStale,
  });
  const runtimeMode = deriveRuntimeMode(state);
  const recoveryNow = useRecoveryClock(runtimeMode);

  const {
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
  } = useSettingsToggles({ state, setState });

  const { handleTelegramAlertsToggle, saveTelegramCredentials, testTelegramAlerts, loadTelegramSettings } =
    useTelegramSettings({ state, setState });

  const handleAddToQueue = async (requestedGame: TwitchGame | null = state.selectedGame) => {
    if (!requestedGame || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await sendRuntimeMessage({
        type: 'ADD_TO_QUEUE',
        payload: { game: requestedGame },
      });
      if (!response?.success) {
        setQueueMessage('Unable to add campaign to queue.');
        return;
      }
      if (response.added) {
        if (onboardingStep === 'selector') setOnboardingStep('start');
        setQueueMessage(`Added "${getGameDisplayLabel(requestedGame)}" to queue.`);
        return;
      }
      if (response.reason === 'farming-complete') {
        setQueueMessage(formatFarmingCompleteQueueMessage(requestedGame));
        return;
      }
      if (response.reason === 'already-completed') {
        setQueueMessage(`"${getGameDisplayLabel(requestedGame)}" already has all rewards completed.`);
        return;
      }
      if (response.reason === 'already-queued') {
        setQueueMessage(`"${getGameDisplayLabel(requestedGame)}" is already in queue.`);
        return;
      }
      setQueueMessage(`"${getGameDisplayLabel(requestedGame)}" was not added to queue.`);
    } catch {
      setQueueMessage('Queue add failed.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleAddAllToQueue = async (games: readonly TwitchGame[]) => {
    if (games.length === 0 || actionLoading) return;
    setActionLoading(true);
    let added = 0;
    try {
      for (const game of games) {
        const response = await sendRuntimeMessage({ type: 'ADD_TO_QUEUE', payload: { game } });
        if (response?.success && response.added) added += 1;
      }
      setQueueMessage(
        added > 0
          ? `Added ${added} ${added === 1 ? 'campaign' : 'campaigns'} to queue.`
          : 'No additional farmable campaigns were added.',
      );
      if (added > 0 && onboardingStep === 'selector') setOnboardingStep('start');
    } catch {
      setQueueMessage('Unable to add all available campaigns.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleLinkAccount = () => {
    void Promise.all([
      browser.alarms.create('campaignLinkRecheck:1', { delayInMinutes: 0.5 }),
      browser.alarms.create('campaignLinkRecheck:2', { delayInMinutes: 1.5 }),
    ]).catch(() => undefined);
  };

  const handleSetFavorite = async (game: TwitchGame, favorite: boolean) => {
    const previousFavorites = state.favoriteGames;
    const categoryKey = gameCategoryKey(game);
    const categoryAliases = new Set(gameCategoryIdentityKeys(game));
    setState((prev) => ({
      ...prev,
      favoriteGames: favorite
        ? isFavoriteGame(game, favoriteGameIdentityKeys(prev.favoriteGames))
          ? prev.favoriteGames
          : [
              ...prev.favoriteGames,
              {
                gameId: categoryKey,
                lastKnownName: game.name,
                addedAt: Date.now(),
                identityKeys: gameCategoryIdentityKeys(game),
              },
            ]
        : prev.favoriteGames.filter(
            (entry) => ![entry.gameId, ...(entry.identityKeys ?? [])].some((key) => categoryAliases.has(key)),
          ),
    }));
    const response = await sendRuntimeMessage({
      type: 'SET_GAME_FAVORITE',
      payload: { game, favorite },
    }).catch(() => null);
    if (!response?.success) {
      setState((prev) => ({ ...prev, favoriteGames: previousFavorites }));
      setQueueMessage('Unable to update favorite games.');
    }
  };

  const handleRemoveFromQueue = async (game: TwitchGame) => {
    try {
      const response = await sendRuntimeMessage({ type: 'REMOVE_FROM_QUEUE', payload: { game } });
      if (!response?.success || response.removed === 0) {
        setQueueMessage(response?.error ?? 'Unable to remove campaign from queue.');
      }
    } catch (err: unknown) {
      logPopupWarn('REMOVE_FROM_QUEUE failed:', err);
      setQueueMessage('Unable to remove campaign from queue.');
    }
  };

  const handleClearQueue = async () => {
    try {
      const response = await sendRuntimeMessage({ type: 'CLEAR_QUEUE' });
      if (response?.success === false) {
        setQueueMessage(response?.error ?? 'Unable to clear queue.');
        return;
      }
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

  const runFarmingControl = useCallback(
    async (type: 'PAUSE_FARMING' | 'RESUME_FARMING' | 'STOP_FARMING') => {
      if (actionLoading) return;
      setActionLoading(true);
      try {
        await sendRuntimeMessage({ type });
      } finally {
        setTimeout(() => setActionLoading(false), 250);
      }
    },
    [actionLoading],
  );

  const handleStart = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
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
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handlePause = useCallback(() => runFarmingControl('PAUSE_FARMING'), [runFarmingControl]);

  const handleResume = useCallback(() => runFarmingControl('RESUME_FARMING'), [runFarmingControl]);

  const handleStop = useCallback(() => runFarmingControl('STOP_FARMING'), [runFarmingControl]);

  if (loading) {
    return (
      <main
        className="dh-view flex items-center justify-center py-12 text-[color:var(--dh-text-soft)]"
        role="status"
        aria-live="polite"
      >
        <div className="spinner rounded-full h-8 w-8 border-[3px] border-twitch-purple border-t-transparent" />
      </main>
    );
  }

  return (
    <div
      ref={viewContainerRef}
      tabIndex={-1}
      className="dh-view w-full max-w-[400px] text-[color:var(--dh-text)] outline-none"
    >
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
          notificationPermissionDenied={notificationPermissionDenied}
          onTelegramAlertsToggle={handleTelegramAlertsToggle}
          onSaveTelegramCredentials={saveTelegramCredentials}
          onTestTelegramAlerts={testTelegramAlerts}
          onLoadTelegramSettings={loadTelegramSettings}
          onAutoResumeOnStartupToggle={() => void handleAutoResumeOnStartupToggle()}
          onAutoStartFavoriteGamesToggle={() => void handleAutoStartFavoriteGamesToggle()}
          onFarmCategoryScopeChange={(scope) => void handleFarmCategoryScopeChange(scope)}
          onWatchTransportModeChange={(mode) => void handleWatchTransportModeChange(mode)}
          favoriteGamesCount={state.favoriteGames.length}
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
          runtimeMode={runtimeMode}
          recoveryNow={recoveryNow}
          onboardingStep={onboardingStep}
          firstSyncConfirmation={firstSyncConfirmation}
          firstSyncCampaignCount={firstSyncCampaignCount}
          queueMessage={queueMessage}
          onMuteToggle={() => void handleMuteFarmingTabToggle()}
          onOpenDropsPage={() => void openDropsPage()}
          onOpenMonitor={openMiniDashboard}
          onOpenSettings={() => setActiveView('settings')}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onRefreshCampaigns={() => void openDropsPage()}
          onAddToQueue={(game) => void handleAddToQueue(game ?? state.selectedGame)}
          onAddAllToQueue={(games) => void handleAddAllToQueue(games)}
          onLinkAccount={handleLinkAccount}
          onSetFavorite={(game, favorite) => void handleSetFavorite(game, favorite)}
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
