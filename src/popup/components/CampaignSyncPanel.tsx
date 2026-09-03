// Extracted from src/popup/App.tsx (CampaignSyncPanel component).
import type { CampaignSyncStatus } from '../constants';
import { DropsIcon } from './icons';

export interface CampaignSyncPanelProps {
  status: CampaignSyncStatus;
  error: string | null;
  hasCachedCampaigns: boolean;
  onRefresh: () => void;
}

export function CampaignSyncPanel({ status, error, hasCachedCampaigns, onRefresh }: CampaignSyncPanelProps) {
  if (status === 'fresh' || status === 'signed-out') {
    return null;
  }

  const isSyncing = status === 'syncing';
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
          ? 'Updating campaigns…'
          : status === 'waiting'
            ? 'Campaign update will retry automatically.'
            : 'No active campaigns found.';

  return (
    <section
      className={`dh-contain rounded-lg border px-2.5 py-2 ${panelTone}`}
      aria-live="polite"
      aria-busy={isSyncing}
      aria-label="Campaign sync status"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] leading-snug text-[color:var(--dh-text-soft)]">{message}</p>
          {status === 'failed' && error && (
            <p className="mt-0.5 truncate text-[10px] text-[color:var(--dh-muted)]" title={error}>
              {error}
            </p>
          )}
        </div>
        {isSyncing || status === 'stale' ? (
          <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent shrink-0 mt-0.5" />
        ) : status !== 'waiting' ? (
          <button
            type="button"
            onClick={onRefresh}
            className="dh-focus inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg bg-twitch-purple/70 px-2 py-1 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/75"
          >
            <DropsIcon size={14} />
            Open Twitch Drops
          </button>
        ) : null}
      </div>
    </section>
  );
}
