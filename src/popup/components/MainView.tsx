// Extracted from src/popup/App.tsx (main view markup).
import type { RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop, TwitchGame } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import { formatEtaMinutes, recoveryAttemptLabel, retryLabel, statusReasonLabel } from '../format';
import { isSameQueuedGame } from '../queue-start';
import { CampaignSelector } from './CampaignSelector';
import { CampaignSyncPanel } from './CampaignSyncPanel';
import { PopupHeader } from './PopupHeader';
import { QueueChips } from './QueueChips';
import { RewardList } from './RewardList';

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
  onNotificationsToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRefreshCampaigns: () => void;
  onSelectGame: (gameId: string) => void;
  onAddToQueue: () => void;
  onRemoveFromQueue: (game: TwitchGame) => void;
  onClearQueue: () => void;
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
  onNotificationsToggle,
  onPause,
  onResume,
  onStop,
  onRefreshCampaigns,
  onSelectGame,
  onAddToQueue,
  onRemoveFromQueue,
  onClearQueue,
  onStart,
}: MainViewProps) {
  return (
    <div className="flex flex-col">
      <PopupHeader
        state={state}
        actionLoading={actionLoading}
        dropsRefreshLoading={dropsRefreshLoading}
        onMuteToggle={onMuteToggle}
        onOpenDropsPage={onOpenDropsPage}
        onOpenMonitor={onOpenMonitor}
        onOpenSettings={onOpenSettings}
        onNotificationsToggle={onNotificationsToggle}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
      />

      {state.resumedFromCrash != null && (
        <div className="px-3 py-1.5 bg-yellow-500/20 border-b border-yellow-500/30 text-yellow-200 text-[11px] font-medium flex items-center gap-1.5">
          <span>⚡</span>
          <span>Resumed after unexpected shutdown — re-syncing…</span>
        </div>
      )}

      <div className="px-3 py-2.5 space-y-2.5">
        <CampaignSyncPanel
          status={campaignSyncStatus}
          error={activeSyncError}
          hasCachedCampaigns={state.availableGames.length > 0}
          lastUpdated={state.lastSuccessfulRefreshAt}
          onRefresh={onRefreshCampaigns}
        />

        {!dropsRefreshLoading && firstSyncConfirmation && firstSyncCampaignCount != null && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-200">
            ✅ {firstSyncCampaignCount} campaigns loaded — select a game below and press Start
          </div>
        )}

        <CampaignSelector
          selectedGame={state.selectedGame}
          sortedGames={sortedGames}
          isRunning={state.isRunning}
          actionLoading={actionLoading}
          onboardingStep={onboardingStep}
          onSelect={onSelectGame}
          onAddToQueue={onAddToQueue}
        />

        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-[11px] text-blue-300 min-h-[1em]"
        >
          {queueMessage ?? ''}
        </p>

        {runtimeMode === 'recovering' && state.recoveryReason && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
            <p className="text-[11px] font-semibold text-yellow-300">
              {statusReasonLabel(state.recoveryReason)}
              {recoveryAttemptLabel(state.recoveryReason, state.recoveryAttempts)
                ? ` · ${recoveryAttemptLabel(state.recoveryReason, state.recoveryAttempts)}`
                : ''}
              {retryLabel(state.recoveryBackoffUntil, recoveryNow)
                ? ` · ${retryLabel(state.recoveryBackoffUntil, recoveryNow)}`
                : ''}
            </p>
          </div>
        )}

        {runtimeMode === 'stopped-terminal' && state.lastStopMessage && (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[11px] text-gray-300">{state.lastStopMessage}</p>
          </div>
        )}

        <QueueChips
          selectedGame={state.selectedGame}
          queueGames={queueGames}
          isRunning={state.isRunning}
          onRemove={onRemoveFromQueue}
          onClear={onClearQueue}
        />

        {/* Start button (only when not running) */}
        {!state.isRunning &&
          (() => {
            const selectedNotInQueue =
              !!state.selectedGame &&
              queueGames.length > 0 &&
              !queueGames.some((g) => isSameQueuedGame(g, state.selectedGame!));
            const effectiveCount = selectedNotInQueue ? queueGames.length + 1 : queueGames.length;

            const selectedGameCompleted =
              (state.selectedGame?.allDropsCompleted ?? false) && queueGames.length === 0;
            const allQueuedCompleted =
              effectiveCount > 0 &&
              (selectedNotInQueue ? (state.selectedGame!.allDropsCompleted ?? false) : true) &&
              queueGames.every((g) => g.allDropsCompleted ?? false);
            const allDropsClaimed = selectedGameCompleted || allQueuedCompleted;
            return (
              <>
                <button
                  type="button"
                  onClick={onStart}
                  disabled={
                    (!state.selectedGame && queueGames.length === 0) || actionLoading || allDropsClaimed
                  }
                  className={`w-full rounded-lg bg-green-600 py-2 text-sm font-semibold disabled:bg-gray-700 disabled:opacity-50 hover:bg-green-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${onboardingStep === 'start' ? 'onboarding-pulse' : ''}`}
                >
                  {actionLoading
                    ? 'Starting…'
                    : effectiveCount > 0
                      ? `Start Queue (${effectiveCount})`
                      : 'Start Farming'}
                </button>
                {allDropsClaimed && (
                  <p className="text-center text-[11px] text-gray-400 mt-1">All rewards already claimed</p>
                )}
              </>
            );
          })()}

        {/* Status line (only when running) */}
        {state.isRunning && (
          <p className="text-xs text-gray-300">
            {state.activeStreamer && (
              <>
                <span className="text-white font-medium">{state.activeStreamer.displayName}</span>
                <span className="text-gray-500">
                  {' '}
                  · {state.activeStreamer.viewerCount?.toLocaleString() ?? '?'} viewers
                </span>
              </>
            )}
            {state.currentDrop && (
              <>
                {state.activeStreamer && <span className="text-gray-500"> · </span>}
                <span className="text-purple-300">
                  {state.currentDrop.name} {state.currentDrop.progress}%
                </span>
                {(() => {
                  const eta = formatEtaMinutes(state.currentDrop.remainingMinutes);
                  return eta ? <span className="text-gray-500"> · ETA {eta}</span> : null;
                })()}
              </>
            )}
            {!state.activeStreamer && !state.currentDrop && (
              <span className="text-gray-400">Searching for a streamer…</span>
            )}
          </p>
        )}

        {(state.selectedGame || state.isRunning || pendingDrops.length > 0 || completedDrops.length > 0) && (
          <RewardList
            pendingDrops={pendingDrops}
            completedDrops={state.selectedGame ? completedDrops : []}
            rewardsLoading={rewardsLoading}
            syncLoading={dropsRefreshLoading}
            claimableCount={claimableCount}
          />
        )}
      </div>
    </div>
  );
}
