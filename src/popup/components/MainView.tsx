// Extracted from src/popup/App.tsx (main view markup).
import { getGameDisplayLabel } from '../../shared/game-selection';
import { formatStopReason, type RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop, TwitchGame } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import {
  expiryLabel,
  formatEtaMinutes,
  recoveryAttemptLabel,
  retryLabel,
  statusReasonLabel,
} from '../format';
import { isSameQueuedGame, queueGameIdentity } from '../queue-start';
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
                {game.allDropsCompleted ? '\u2705 ' : game.isConnected === false ? '\u{1F512} ' : ''}
                {getGameDisplayLabel(game)} · {expiryLabel(game.expiryStatus)}
              </option>
            ))}
          </select>
          {!state.isRunning && (
            <button
              type="button"
              onClick={onAddToQueue}
              disabled={!state.selectedGame || actionLoading}
              className="dh-action-secondary dh-focus min-h-8 shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-55"
              aria-label="Add selected campaign to queue"
            >
              Queue
            </button>
          )}
        </div>

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

        {runtimeMode === 'stopped-terminal' &&
          (state.lastStopMessage || formatStopReason(state.lastStopReason)) && (
            <div className="dh-panel dh-contain px-3 py-2" role="status" aria-live="polite">
              <p className="text-[11px] text-[color:var(--dh-text-soft)]">
                {state.lastStopMessage ?? formatStopReason(state.lastStopReason)}
              </p>
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
                  className={`dh-action-primary dh-focus w-full rounded-lg py-2 text-sm font-semibold disabled:opacity-70 ${onboardingStep === 'start' ? 'onboarding-pulse' : ''}`}
                >
                  {actionLoading
                    ? 'Starting…'
                    : effectiveCount > 0
                      ? `Start Queue (${effectiveCount})`
                      : 'Start Farming'}
                </button>
                {allDropsClaimed && (
                  <p className="dh-copy mt-1 text-center text-[11px]">All rewards already claimed</p>
                )}
              </>
            );
          })()}

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
            {state.currentDrop && (
              <>
                {state.activeStreamer && <span className="dh-faint"> · </span>}
                <span className="text-purple-300">
                  {state.currentDrop.name} {state.currentDrop.progress}%
                </span>
                {(() => {
                  const eta = formatEtaMinutes(state.currentDrop.remainingMinutes);
                  return eta ? <span className="dh-faint"> · ETA {eta}</span> : null;
                })()}
              </>
            )}
            {!state.activeStreamer && !state.currentDrop && (
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
