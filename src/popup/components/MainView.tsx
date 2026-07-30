import { isRewardAutomatable } from '../../shared/reward-semantics';
import type { RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop, TwitchGame } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import { getCampaignIndicatorKinds, getCampaignStatusLines, isCampaignFarmable } from '../format';
import { getGameToStartFromQueue, isSameQueuedGame } from '../queue-start';
import { CampaignSelector } from './CampaignSelector';
import { CampaignStatusIndicators } from './CampaignStatusIndicators';
import { CampaignSyncPanel } from './CampaignSyncPanel';
import { CheckIcon, RecoveryIcon } from './icons';
import { PopupHeader } from './PopupHeader';
import { QueueChips } from './QueueChips';
import { RewardList } from './RewardList';
import { SessionSummary } from './SessionSummary';

export interface MainViewProps {
  state: AppState;
  actionLoading: boolean;
  dropsRefreshLoading: boolean;
  campaignSyncStatus: CampaignSyncStatus;
  activeSyncError: string | null;
  sortedGames: TwitchGame[];
  queueGames: TwitchGame[];
  pendingDrops: TwitchDrop[];
  completedDrops: TwitchDrop[];
  claimableCount: number;
  runtimeMode: RuntimeMode;
  recoveryNow: number;
  onboardingStep: 'selector' | 'start' | null;
  firstSyncConfirmation: boolean;
  firstSyncCampaignCount: number | null;
  queueMessage: string | null;
  rewardsLoading: boolean;
  onMuteToggle: () => void;
  onOpenDropsPage: () => void;
  onOpenMonitor: () => void;
  onOpenSettings: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRefreshCampaigns: () => void;
  onSelectGame: (gameId: string) => void;
  onAddToQueue: () => void;
  onRemoveFromQueue: (game: TwitchGame) => void;
  onClearQueue: () => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onStart: () => void;
}

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
  claimableCount,
  runtimeMode,
  recoveryNow,
  onboardingStep,
  firstSyncConfirmation,
  firstSyncCampaignCount,
  queueMessage,
  rewardsLoading,
  onMuteToggle,
  onOpenDropsPage,
  onOpenMonitor,
  onOpenSettings,
  onPause,
  onResume,
  onStop,
  onRefreshCampaigns,
  onSelectGame,
  onAddToQueue,
  onRemoveFromQueue,
  onClearQueue,
  onReorderQueue,
  onStart,
}: MainViewProps) {
  const selectedGame = state.selectedGame;
  const currentAutomatableDrop =
    state.currentDrop && isRewardAutomatable(state.currentDrop) ? state.currentDrop : null;
  const visiblePendingDrops =
    state.isRunning && currentAutomatableDrop
      ? pendingDrops.filter(
          (drop) =>
            drop.id !== currentAutomatableDrop.id ||
            (drop.campaignId ?? null) !== (currentAutomatableDrop.campaignId ?? null),
        )
      : pendingDrops;
  const visibleClaimableCount = state.isRunning
    ? visiblePendingDrops.filter((drop) => drop.claimable && isRewardAutomatable(drop)).length
    : claimableCount;
  const selectedCampaignStatusLines = selectedGame ? getCampaignStatusLines(selectedGame) : [];
  const selectedCampaignHasStatus =
    selectedGame != null &&
    (selectedCampaignStatusLines.length > 0 || getCampaignIndicatorKinds(selectedGame).length > 0);
  const selectedNotInQueue =
    selectedGame != null &&
    queueGames.length > 0 &&
    !queueGames.some((game) => isSameQueuedGame(game, selectedGame));
  const selectedContributesToQueue =
    selectedNotInQueue && selectedGame != null && isCampaignFarmable(selectedGame);
  const effectiveQueueCount = queueGames.length + (selectedContributesToQueue ? 1 : 0);
  const gameToStart = getGameToStartFromQueue(selectedGame, queueGames);
  const startDisabled = gameToStart == null || !isCampaignFarmable(gameToStart);
  const isSignedOut = campaignSyncStatus === 'signed-out';

  return (
    <div className="flex flex-col">
      <PopupHeader
        state={state}
        actionLoading={actionLoading}
        onMuteToggle={onMuteToggle}
        onOpenMonitor={onOpenMonitor}
        onOpenSettings={onOpenSettings}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
      />

      {state.resumedFromCrash != null && (
        <div className="flex items-center gap-1.5 border-b border-yellow-500/30 bg-yellow-500/20 px-3 py-1.5 text-xs font-medium text-yellow-200">
          <RecoveryIcon />
          <span>Resumed after unexpected shutdown, re-syncing…</span>
        </div>
      )}

      <main className="dh-page">
        <SessionSummary
          state={state}
          runtimeMode={runtimeMode}
          campaignSyncStatus={campaignSyncStatus}
          currentAutomatableDrop={currentAutomatableDrop}
          recoveryNow={recoveryNow}
        />

        <CampaignSyncPanel
          status={campaignSyncStatus}
          error={activeSyncError}
          hasCachedCampaigns={state.availableGames.length > 0}
          lastUpdated={state.lastSuccessfulRefreshAt}
          onRefresh={onRefreshCampaigns}
        />

        {isSignedOut ? (
          queueGames.length > 0 && (
            <p
              className="dh-panel dh-contain px-3 py-2.5 text-xs text-[color:var(--dh-text-soft)]"
              data-saved-queue-count={queueGames.length}
            >
              Saved queue: {queueGames.length} {queueGames.length === 1 ? 'campaign' : 'campaigns'}.
            </p>
          )
        ) : (
          <>
            {!dropsRefreshLoading && firstSyncConfirmation && firstSyncCampaignCount != null && (
              <div className="dh-contain flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-200">
                <CheckIcon />
                <span>
                  {firstSyncCampaignCount} campaigns loaded. Select a campaign below and press Start.
                </span>
              </div>
            )}

            {!state.isRunning && (
              <CampaignSelector
                selectedGame={state.selectedGame}
                sortedGames={sortedGames}
                queueGames={queueGames}
                actionLoading={actionLoading}
                highlighted={onboardingStep === 'selector'}
                onSelectGame={onSelectGame}
                onAddToQueue={onAddToQueue}
              />
            )}

            {state.selectedGame && selectedCampaignHasStatus && (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex min-w-0 items-start gap-1.5 text-[11px]"
              >
                <CampaignStatusIndicators game={state.selectedGame} />
                <div className="min-w-0 flex-1 space-y-1">
                  {selectedCampaignStatusLines.map((line) => (
                    <p
                      key={line.reason}
                      data-campaign-status-reason={line.reason}
                      className="w-full min-w-0 text-[color:var(--dh-text-soft)] [overflow-wrap:anywhere]"
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {queueMessage && (
              <p role="status" aria-live="polite" aria-atomic="true" className="text-[11px] text-blue-300">
                {queueMessage}
              </p>
            )}

            <QueueChips
              selectedGame={state.selectedGame}
              queueGames={queueGames}
              isRunning={state.isRunning}
              onRemove={onRemoveFromQueue}
              onClear={onClearQueue}
              onReorder={onReorderQueue}
            />

            {!state.isRunning && (
              <button
                type="button"
                onClick={onStart}
                disabled={actionLoading || startDisabled}
                className={`dh-action-primary dh-focus w-full rounded-lg py-2 text-sm font-semibold disabled:opacity-70 ${onboardingStep === 'start' ? 'onboarding-pulse' : ''}`}
              >
                {actionLoading
                  ? 'Starting…'
                  : effectiveQueueCount > 0
                    ? `Start Queue (${effectiveQueueCount})`
                    : 'Start Farming'}
              </button>
            )}

            {runtimeMode === 'stopped-terminal' && state.lastStopReason === 'sign-in-required' && (
              <button
                type="button"
                onClick={onOpenDropsPage}
                className="dh-focus inline-flex min-h-8 w-full items-center justify-center rounded-lg bg-twitch-purple/70 px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/75"
              >
                Sign in on Twitch
              </button>
            )}

            {(state.selectedGame ||
              state.isRunning ||
              pendingDrops.length > 0 ||
              completedDrops.length > 0) && (
              <RewardList
                pendingDrops={visiblePendingDrops}
                completedDrops={state.selectedGame ? completedDrops : []}
                rewardsLoading={rewardsLoading}
                syncLoading={dropsRefreshLoading}
                claimableCount={visibleClaimableCount}
                onOpenDropsPage={onOpenDropsPage}
                hideEmptyPending={state.isRunning}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
