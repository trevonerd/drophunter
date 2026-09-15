// Extracted from src/popup/App.tsx (CampaignSyncPanel component).

import type { CampaignSyncState } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import { campaignValidationFeedback } from './campaign-sync-feedback';
import { DropsIcon } from './icons';

export interface CampaignSyncPanelProps {
  status: CampaignSyncStatus;
  error: string | null;
  hasCachedCampaigns: boolean;
  campaignSyncState: CampaignSyncState;
  blocksStartup?: boolean;
  onOpenTwitchDrops: () => void;
  onRetry: () => void;
}

export function CampaignSyncPanel({
  status,
  error,
  hasCachedCampaigns,
  campaignSyncState,
  blocksStartup = false,
  onOpenTwitchDrops,
  onRetry,
}: CampaignSyncPanelProps) {
  if (status === 'fresh' || status === 'signed-out') {
    return null;
  }

  const isSyncing = status === 'syncing';
  const needsSession = campaignSyncState.status === 'needs-session';
  const retryScheduled =
    campaignSyncState.status === 'retry-scheduled' && campaignSyncState.nextRetryAt > Date.now();
  const showError =
    status === 'failed' &&
    (campaignSyncState.status === 'retry-failed' || campaignSyncState.retryAttemptCount < 3);
  const visibleError =
    error ?? (campaignSyncState.status === 'retry-failed' ? campaignSyncState.error : null);
  const validationFeedback =
    status === 'pending-validation' ? campaignValidationFeedback(campaignSyncState) : null;
  const panelTone =
    status === 'failed'
      ? 'border-red-500/35 bg-red-500/10'
      : status === 'stale'
        ? 'border-yellow-500/35 bg-yellow-500/10'
        : 'border-blue-500/30 bg-blue-500/10';
  const message =
    status === 'failed'
      ? hasCachedCampaigns
        ? 'Campaign update failed. Showing saved data.'
        : 'Campaign update failed. No campaigns are available yet.'
      : status === 'stale'
        ? 'Updating campaigns…'
        : status === 'syncing'
          ? hasCachedCampaigns
            ? 'Validating saved campaigns…'
            : 'Updating campaigns…'
          : status === 'pending-validation'
            ? campaignSyncState.retryAttemptCount >= 3
              ? 'Campaign validation is delayed.'
              : retryScheduled
                ? 'Saved campaigns are pending validation. DropHunter will retry automatically.'
                : 'Saved campaigns are pending validation.'
            : status === 'waiting'
              ? 'Campaigns are waiting for a Twitch session.'
              : 'No active campaigns found.';

  return (
    <section
      className={`dh-contain rounded-lg border px-2.5 py-2 ${panelTone}`}
      aria-live="polite"
      aria-busy={isSyncing}
      aria-label="Campaign sync status"
    >
      <div
        className={`flex gap-2 ${blocksStartup ? 'flex-col items-start' : 'items-center justify-between'}`}
      >
        <div className="min-w-0">
          {blocksStartup && (
            <h2 className="mb-1 text-xs font-semibold text-[color:var(--dh-text)]">
              {needsSession ? 'Open Twitch to continue' : 'Waiting for campaign validation'}
            </h2>
          )}
          <p className="text-[11px] leading-snug text-[color:var(--dh-text-soft)]">{message}</p>
          {validationFeedback && (
            <p className="mt-0.5 text-[10px] text-[color:var(--dh-muted)]">{validationFeedback}</p>
          )}
          {showError && visibleError && (
            <p className="mt-0.5 truncate text-[10px] text-[color:var(--dh-muted)]" title={visibleError}>
              {visibleError}
            </p>
          )}
        </div>
        {isSyncing || status === 'stale' ? (
          <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent shrink-0 mt-0.5" />
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {(status === 'pending-validation' || status === 'failed' || status === 'waiting') && (
              <button
                type="button"
                onClick={onRetry}
                className="dh-focus inline-flex min-h-7 items-center rounded-lg border border-[color:var(--dh-border-strong)] px-2 py-1 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-[color:var(--dh-surface-3)]"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={onOpenTwitchDrops}
              className="dh-focus inline-flex min-h-7 items-center gap-1 rounded-lg bg-twitch-purple/70 px-2 py-1 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/75"
            >
              <DropsIcon size={14} />
              Open Twitch Drops
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
