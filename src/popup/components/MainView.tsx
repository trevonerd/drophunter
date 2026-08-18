import { dropMatchesGame, favoriteGameIdentityKeys, gameKey } from '../../shared/game-selection.ts';
import { isRewardAutomatable } from '../../shared/reward-semantics';
import type { TwitchGame } from '../../types';
import { isCampaignFarmable } from '../format';
import { getGameToStartFromQueue, isSameQueuedGame } from '../queue-start';
import { AutomationSummary } from './AutomationSummary';
import { CampaignList } from './CampaignList';
import { CampaignQueueControls, SelectedCampaignStatus } from './CampaignQueueControls';
import { CampaignSyncPanel } from './CampaignSyncPanel';
import { CheckIcon } from './icons';
import type { MainViewProps } from './main-view-types';
import { PopupHeader } from './PopupHeader';
import { SessionSummary } from './SessionSummary';
import { TwitchSessionGate } from './TwitchSessionGate';

export type { MainViewProps } from './main-view-types';

export function MainView({
  state,
  actionLoading,
  dropsRefreshLoading,
  campaignSyncStatus,
  activeSyncError,
  sortedGames,
  queueGames,
  pendingDrops,
  completedDrops,
  runtimeMode,
  recoveryNow,
  onboardingStep,
  firstSyncConfirmation,
  firstSyncCampaignCount,
  queueMessage,
  notificationPermissionDenied,
  onAutoStartFavoriteGamesToggle,
  onMuteToggle,
  onOpenDropsPage,
  onOpenMonitor,
  onOpenSettings,
  onPause,
  onResume,
  onStop,
  onRefreshCampaigns,
  onAddToQueue,
  onAddAllToQueue,
  onLinkAccount,
  onSetFavorite,
  onRemoveFromQueue,
  onClearQueue,
  onReorderQueue,
  onStart,
}: MainViewProps) {
  const selectedGame = state.selectedGame;
  const currentAutomatableDrop =
    state.currentDrop && isRewardAutomatable(state.currentDrop) ? state.currentDrop : null;
  const campaignCatalogDrops = Object.values(state.campaignDropsByKey ?? {}).flat();
  const catalogDrops =
    campaignCatalogDrops.length > 0
      ? campaignCatalogDrops
      : state.allDrops.length > 0
        ? state.allDrops
        : [...pendingDrops, ...completedDrops];
  const loadedCampaignKeys = new Set(Object.keys(state.campaignDropsByKey ?? {}));
  if (loadedCampaignKeys.size === 0 && state.allDrops.length > 0) {
    for (const game of sortedGames) {
      if (state.allDrops.some((drop) => dropMatchesGame(drop, game))) loadedCampaignKeys.add(gameKey(game));
    }
  }
  const gameToStart = getGameToStartFromQueue(selectedGame, queueGames);
  const startDisabled = gameToStart == null || !isCampaignFarmable(gameToStart);
  const isSignedOut = campaignSyncStatus === 'signed-out';
  const favoriteGames = state.favoriteGames ?? [];
  const campaignPriorityMode = state.campaignPriorityMode ?? 'priority-list-only';
  const campaignAvailabilityByKey = state.campaignAvailabilityByKey ?? {};
  const automationActivity = state.automationActivity ?? [];
  const favoriteIds = favoriteGameIdentityKeys(favoriteGames);
  const now = Date.now();
  const progressForCampaign = (game: TwitchGame) => {
    const nextReward = catalogDrops.find((drop) => dropMatchesGame(drop, game) && !drop.claimed);
    return {
      nextRewardName: nextReward?.benefitName ?? nextReward?.name,
      progress: nextReward?.progress,
      currentMinutes: nextReward?.currentMinutes,
      requiredMinutes: nextReward?.requiredMinutes,
      eligibleStreamerCount: campaignAvailabilityByKey[gameKey(game)]?.eligibleStreamerCount ?? null,
    };
  };
  const recentFavoriteAddition = automationActivity.find(
    (entry) => entry.kind === 'favorite-added' && now - entry.at < 5_000,
  );
  const highlightedGame = recentFavoriteAddition?.campaignId
    ? sortedGames.find((game) => game.campaignId === recentFavoriteAddition.campaignId)
    : undefined;
  const highlightedCampaignKey = highlightedGame ? gameKey(highlightedGame) : null;
  const hasVisibleQueue = queueGames.some(
    (game) => !state.isRunning || !selectedGame || !isSameQueuedGame(game, selectedGame),
  );

  return (
    <div className="flex flex-col">
      <PopupHeader
        state={state}
        onMuteToggle={onMuteToggle}
        onOpenMonitor={onOpenMonitor}
        onOpenSettings={onOpenSettings}
      />

      <main className="dh-page">
        {isSignedOut ? (
          <>
            <TwitchSessionGate queueCount={queueGames.length} onOpenTwitch={onOpenDropsPage} />
            <AutomationSummary
              state={state}
              notificationPermissionDenied={notificationPermissionDenied}
              onToggle={onAutoStartFavoriteGamesToggle}
            />
          </>
        ) : (
          <>
            <AutomationSummary
              state={state}
              notificationPermissionDenied={notificationPermissionDenied}
              onToggle={onAutoStartFavoriteGamesToggle}
            />
            <SessionSummary
              state={state}
              runtimeMode={runtimeMode}
              currentAutomatableDrop={currentAutomatableDrop}
              recoveryNow={recoveryNow}
              actionLoading={actionLoading}
              startDisabled={startDisabled}
              queueCount={queueGames.length}
              startHighlighted={onboardingStep === 'start'}
              onStart={onStart}
              onPause={onPause}
              onResume={onResume}
              onStop={onStop}
              onOpenTwitch={onOpenDropsPage}
            />

            {(hasVisibleQueue || queueMessage) && (
              <section aria-label="Farming queue" className="dh-group min-w-0">
                <CampaignQueueControls
                  selectedGame={state.selectedGame}
                  queueGames={queueGames}
                  isRunning={state.isRunning}
                  campaignPriorityMode={campaignPriorityMode}
                  queueEntryMetadataByKey={state.queueEntryMetadataByKey ?? {}}
                  favoriteGameIds={favoriteIds}
                  now={now}
                  queueMessage={queueMessage}
                  onRemove={onRemoveFromQueue}
                  onClear={onClearQueue}
                  onReorder={onReorderQueue}
                />
              </section>
            )}

            <div className={onboardingStep === 'selector' ? 'onboarding-pulse rounded-lg' : ''}>
              <CampaignList
                campaigns={sortedGames}
                drops={catalogDrops}
                favoriteGameIds={favoriteIds}
                queueGames={queueGames}
                loadedCampaignKeys={loadedCampaignKeys}
                progressByCampaignKey={progressForCampaign}
                priorityMode={campaignPriorityMode}
                highlightedCampaignKey={highlightedCampaignKey}
                actionLoading={actionLoading}
                now={now}
                runningGame={state.isRunning ? state.selectedGame : null}
                beforeCatalog={
                  <>
                    <CampaignSyncPanel
                      status={campaignSyncStatus}
                      error={activeSyncError}
                      hasCachedCampaigns={state.availableGames.length > 0}
                      onRefresh={onRefreshCampaigns}
                    />
                    {!dropsRefreshLoading && firstSyncConfirmation && firstSyncCampaignCount != null && (
                      <div className="dh-contain flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-2.5 py-2 text-[11px] text-green-200">
                        <CheckIcon />
                        <span>{firstSyncCampaignCount} campaigns loaded.</span>
                      </div>
                    )}
                    <SelectedCampaignStatus selectedGame={state.selectedGame} />
                  </>
                }
                onOpenTwitchDrops={onOpenDropsPage}
                onSetFavorite={onSetFavorite}
                onAddToQueue={(game) => onAddToQueue(game)}
                onAddAllToQueue={onAddAllToQueue}
                onRemoveFromQueue={onRemoveFromQueue}
                onLinkAccount={onLinkAccount}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
