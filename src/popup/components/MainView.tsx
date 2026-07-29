// Extracted from src/popup/App.tsx (main view markup).

import { isRewardAutomatable } from '../../shared/reward-semantics';
import { formatStopReason, type RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop, TwitchGame } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import {
  formatCampaignOptionLabel,
  formatEtaMinutes,
  getCampaignStatusLines,
  isCampaignFarmable,
  recoveryAttemptLabel,
  retryLabel,
  statusReasonLabel,
} from '../format';
import { getGameToStartFromQueue, isSameQueuedGame, queueGameIdentity } from '../queue-start';
import { CampaignStatusIndicators } from './CampaignStatusIndicators';
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
  onNotificationsToggle,
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
  const selectedCampaignStatusLines = selectedGame ? getCampaignStatusLines(selectedGame) : [];
  const selectedNotInQueue =
    selectedGame != null &&
    queueGames.length > 0 &&
    !queueGames.some((game) => isSameQueuedGame(game, selectedGame));
  const selectedContributesToQueue =
    selectedNotInQueue && selectedGame != null && isCampaignFarmable(selectedGame);
  const effectiveQueueCount = queueGames.length + (selectedContributesToQueue ? 1 : 0);
  const gameToStart = getGameToStartFromQueue(selectedGame, queueGames);
  const startDisabled = gameToStart == null || !isCampaignFarmable(gameToStart);
  const formattedStopReason = formatStopReason(state.lastStopReason);
  const terminalStopMessage = formattedStopReason ?? state.lastStopMessage;
  const terminalStopMessageAlreadyShown = selectedCampaignStatusLines.some(
    (line) => line.text === terminalStopMessage,
  );

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
        <div className="flex items-center gap-1.5 border-b border-yellow-500/30 bg-yellow-500/20 px-3 py-1.5 text-[11px] font-medium text-yellow-200">
          <span>⚡</span>
          <span>Resumed after unexpected shutdown, re-syncing…</span>
        </div>
      )}

      <div className="dh-page">
        <CampaignSyncPanel
          status={campaignSyncStatus}
          error={activeSyncError}
          hasCachedCampaigns={state.availableGames.length > 0}
          lastUpdated={state.lastSuccessfulRefreshAt}
          onRefresh={onRefreshCampaigns}
        />

        {!dropsRefreshLoading && firstSyncConfirmation && firstSyncCampaignCount != null && (
          <div className="dh-contain rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-200">
            ✅ {firstSyncCampaignCount} campaigns loaded. Select a campaign below and press Start.
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <select
            aria-label="Campaign"
            value={state.selectedGame ? queueGameIdentity(state.selectedGame) : ''}
            onChange={(e) => onSelectGame(e.target.value)}
            className={`dh-input min-h-8 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs [&>option]:bg-twitch-dark [&>option]:text-[color:var(--dh-text)] ${onboardingStep === 'selector' ? 'onboarding-pulse' : ''}`}
            disabled={state.isRunning}
          >
            <option value="">Select a campaign to start</option>
            {sortedGames.map((game) => (
              <option key={queueGameIdentity(game)} value={queueGameIdentity(game)}>
                {formatCampaignOptionLabel(game, queueGames)}
              </option>
            ))}
          </select>
          {!state.isRunning && (
            <button
              type="button"
              onClick={onAddToQueue}
              disabled={!state.selectedGame || actionLoading || !isCampaignFarmable(state.selectedGame)}
              className="dh-action-secondary dh-focus min-h-8 shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-55"
              aria-label="Add selected campaign to queue"
            >
              Queue
            </button>
          )}
        </div>

        {state.selectedGame && (
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

        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-[11px] text-blue-300 min-h-[1em]"
        >
          {queueMessage ?? ''}
        </p>

        {runtimeMode === 'recovering' && state.recoveryReason && (
          <div className="dh-contain rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
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

        {runtimeMode === 'stopped-terminal' && terminalStopMessage && !terminalStopMessageAlreadyShown && (
          <div className="dh-panel dh-contain px-3 py-2" role="status" aria-live="polite">
            <p className="text-[11px] text-[color:var(--dh-text-soft)]">{terminalStopMessage}</p>
            {state.lastStopReason === 'sign-in-required' && (
              <button
                type="button"
                onClick={onOpenDropsPage}
                className="dh-focus mt-2 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-twitch-purple/80 px-3 py-1.5 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple"
              >
                Sign in on Twitch
              </button>
            )}
          </div>
        )}

        <QueueChips
          selectedGame={state.selectedGame}
          queueGames={queueGames}
          isRunning={state.isRunning}
          onRemove={onRemoveFromQueue}
          onClear={onClearQueue}
          onReorder={onReorderQueue}
        />

        {/* Start button (only when not running) */}
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

        {/* Status line (only when running) */}
        {state.isRunning && (
          <p className="text-xs text-[color:var(--dh-text-soft)]">
            {state.activeStreamer && (
              <>
                <span className="font-medium text-[color:var(--dh-text)]">
                  {state.activeStreamer.displayName}
                </span>
                <span className="dh-faint">
                  {' '}
                  · {state.activeStreamer.viewerCount?.toLocaleString() ?? '?'} viewers
                </span>
              </>
            )}
            {currentAutomatableDrop && (
              <>
                {state.activeStreamer && <span className="dh-faint"> · </span>}
                <span className="text-purple-300">
                  {currentAutomatableDrop.name} {currentAutomatableDrop.progress}%
                </span>
                {(() => {
                  const eta = formatEtaMinutes(currentAutomatableDrop.remainingMinutes);
                  return eta ? <span className="dh-faint"> · ETA {eta}</span> : null;
                })()}
              </>
            )}
            {!state.activeStreamer && !currentAutomatableDrop && (
              <span className="dh-copy">Searching for a streamer…</span>
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
