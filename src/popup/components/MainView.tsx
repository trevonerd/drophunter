import { AutomationSummary } from './AutomationSummary';
import { CampaignList } from './CampaignList';
import { CampaignQueueControls } from './CampaignQueueControls';
import { CampaignSyncPanel } from './CampaignSyncPanel';
import { CheckIcon } from './icons';
import { createMainViewModel } from './main-view-model.ts';
import type { MainViewProps } from './main-view-types';
import { PopupHeader } from './PopupHeader';
import { QueueCleanupNotice } from './QueueCleanupNotice';
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
  dismissedQueueCleanupActivityId,
  notificationPermissionDenied,
  onAutoStartFavoriteGamesToggle,
  onMuteToggle,
  onOpenDropsPage,
  onOpenMonitor,
  onOpenSettings,
  onPause,
  onResume,
  onStop,
  onDismissQueueCleanup,
  onAddToQueue,
  onAddAllToQueue,
  onLinkAccount,
  onSetGamePreference,
  onRemoveFromQueue,
  onClearQueue,
  onReorderQueue,
  onStartQueuedCampaign,
  onStart,
}: MainViewProps) {
  const model = createMainViewModel({
    state,
    campaignSyncStatus,
    sortedGames,
    queueGames,
    pendingDrops,
    completedDrops,
    dismissedQueueCleanupActivityId,
  });
  const queueCleanupActivity = model.queueCleanupActivity;
  const queueCampaignRemovalNotice = queueCleanupActivity ? (
    <QueueCleanupNotice
      summary={
        queueCleanupActivity.kind === 'queue-retries-exhausted'
          ? 'Farming stopped'
          : queueCleanupActivity.kind === 'queue-campaign-skipped'
            ? 'Campaign skipped'
            : 'Queue updated'
      }
      message={queueCleanupActivity.message}
      onDismiss={() => onDismissQueueCleanup(queueCleanupActivity.id)}
    />
  ) : null;
  const syncPanel = (
    <CampaignSyncPanel
      status={campaignSyncStatus}
      error={activeSyncError}
      hasCachedCampaigns={state.availableGames.length > 0}
      campaignSyncState={state.campaignSyncState}
      blocksStartup={model.startup.isBlocking}
      onOpenTwitchDrops={onOpenDropsPage}
    />
  );

  return (
    <div className="flex flex-col">
      <PopupHeader
        state={state}
        onMuteToggle={onMuteToggle}
        onOpenDropsPage={onOpenDropsPage}
        onOpenMonitor={onOpenMonitor}
        onOpenSettings={onOpenSettings}
      />

      <main className="dh-page">
        {model.sessionRequired ? (
          <>
            <TwitchSessionGate queueCount={queueGames.length} onOpenTwitch={onOpenDropsPage} />
            <AutomationSummary
              state={state}
              notificationPermissionDenied={notificationPermissionDenied}
              onToggle={onAutoStartFavoriteGamesToggle}
            />
            {queueCampaignRemovalNotice}
          </>
        ) : (
          <>
            {model.startup.isBlocking && syncPanel}
            <AutomationSummary
              state={state}
              notificationPermissionDenied={notificationPermissionDenied}
              onToggle={onAutoStartFavoriteGamesToggle}
            />
            {queueCampaignRemovalNotice}
            <SessionSummary
              state={state}
              runtimeMode={runtimeMode}
              currentAutomatableDrop={model.currentAutomatableDrop}
              recoveryNow={recoveryNow}
              actionLoading={actionLoading}
              startDisabled={model.startDisabled}
              automaticStartPending={model.startup.automaticStartPending}
              showSelectedCampaignStatus={model.showSelectedCampaignStatus}
              queueCount={queueGames.length}
              startHighlighted={onboardingStep === 'start'}
              onStart={onStart}
              onPause={onPause}
              onResume={onResume}
              onStop={onStop}
              onOpenTwitch={onOpenDropsPage}
            />

            {(model.hasVisibleQueue || queueMessage) && (
              <section aria-label="Farming queue" className="dh-group min-w-0">
                <CampaignQueueControls
                  selectedGame={state.selectedGame}
                  queueGames={queueGames}
                  isRunning={state.isRunning}
                  campaignPriorityMode={model.campaignPriorityMode}
                  queueEntryMetadataByKey={state.queueEntryMetadataByKey ?? {}}
                  favoriteGameIds={model.favoriteIds}
                  now={model.now}
                  queueMessage={queueMessage}
                  onRemove={onRemoveFromQueue}
                  onClear={onClearQueue}
                  onReorder={onReorderQueue}
                  onStartQueuedCampaign={onStartQueuedCampaign}
                  actionLoading={actionLoading}
                />
              </section>
            )}

            <div className={onboardingStep === 'selector' ? 'onboarding-pulse rounded-lg' : ''}>
              <CampaignList
                campaigns={sortedGames}
                drops={model.catalogDrops}
                favoriteGameIds={model.favoriteIds}
                hiddenGameIds={model.hiddenIds}
                queueGames={queueGames}
                loadedCampaignKeys={model.loadedCampaignKeys}
                refreshInProgress={dropsRefreshLoading}
                refreshStartedAt={state.lastDropsPageRefreshAttemptAt}
                progressByCampaignKey={model.campaignProgressByKey}
                priorityMode={model.campaignPriorityMode}
                highlightedCampaignKey={model.highlightedCampaignKey}
                actionLoading={actionLoading}
                now={model.now}
                runningGame={state.isRunning && !state.isPaused ? state.selectedGame : null}
                beforeCatalog={
                  <>
                    {!model.startup.isBlocking && syncPanel}
                    {!dropsRefreshLoading &&
                      campaignSyncStatus === 'fresh' &&
                      firstSyncConfirmation &&
                      firstSyncCampaignCount != null && (
                        <div className="dh-contain flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-2.5 py-2 text-[11px] text-green-200">
                          <CheckIcon />
                          <span>{firstSyncCampaignCount} campaigns loaded.</span>
                        </div>
                      )}
                  </>
                }
                onOpenTwitchDrops={onOpenDropsPage}
                onSetGamePreference={onSetGamePreference}
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
