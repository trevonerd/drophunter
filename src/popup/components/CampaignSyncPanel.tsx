// Extracted from src/popup/App.tsx (CampaignSyncPanel component).
import type { CampaignSyncStatus } from '../constants';
import { formatLastUpdated } from '../format';
import { DropsIcon } from './icons';

export interface CampaignSyncPanelProps {
  status: CampaignSyncStatus;
  error: string | null;
  hasCachedCampaigns: boolean;
  lastUpdated?: number;
  onRefresh: () => void;
}

export function CampaignSyncPanel({
  status,
  error,
  hasCachedCampaigns,
  lastUpdated,
  onRefresh,
}: CampaignSyncPanelProps) {
  if (status === 'fresh') {
    return null;
  }

  const isSyncing = status === 'syncing';
  const panelTone =
    status === 'failed'
      ? 'border-red-500/35 bg-red-500/10'
      : status === 'stale'
        ? 'border-yellow-500/35 bg-yellow-500/10'
        : status === 'signed-out'
          ? 'border-purple-500/35 bg-purple-500/10'
          : 'border-blue-500/30 bg-blue-500/10';
  const title =
    status === 'failed'
      ? 'Could not update campaigns'
      : status === 'stale'
        ? 'Updating campaigns'
        : status === 'syncing'
          ? 'Updating campaigns'
          : status === 'signed-out'
            ? 'Sign in to Twitch'
            : 'No active campaigns';
  const description =
    status === 'failed'
      ? hasCachedCampaigns
        ? 'Could not update. Old data is still shown.'
        : 'Could not update yet. No campaign data is shown.'
      : status === 'stale'
        ? 'Checking Twitch for fresh campaigns…'
        : status === 'syncing'
          ? 'Updating Twitch Drops and campaigns…'
          : status === 'signed-out'
            ? 'DropHunter needs an active Twitch session. Open Twitch, sign in, then come back here.'
            : 'Signed in, but no active Drops campaigns were found. Open Twitch Drops to check again.';
  const detail = status === 'failed' && error ? error : formatLastUpdated(lastUpdated);
  const buttonLabel = status === 'signed-out' ? 'Open Twitch' : 'Open Twitch Drops';

  return (
    <section
      className={`dh-contain rounded-lg p-3 border ${panelTone}`}
      aria-live="polite"
      aria-busy={isSyncing}
      aria-label="Campaign sync status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="dh-title text-xs">{title}</p>
          <p className="mt-1 text-xs text-[color:var(--dh-text-soft)]">{description}</p>
          <p className="mt-1 break-words text-[11px] text-[color:var(--dh-muted)]">{detail}</p>
        </div>
        {isSyncing || status === 'stale' ? (
          <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent shrink-0 mt-0.5" />
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            className="dh-focus inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-twitch-purple/70 px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/75"
          >
            <DropsIcon size={14} />
            {buttonLabel}
          </button>
        )}
      </div>
    </section>
  );
}
