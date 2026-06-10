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
  const isEmpty = status === 'empty';
  const panelTone =
    status === 'failed'
      ? 'border-red-500/35 bg-red-500/10'
      : status === 'stale'
        ? 'border-yellow-500/35 bg-yellow-500/10'
        : 'border-blue-500/30 bg-blue-500/10';
  const title =
    status === 'failed'
      ? 'Could not update campaigns'
      : status === 'stale'
        ? 'Updating campaigns'
        : status === 'syncing'
          ? 'Updating campaigns'
          : 'Go to Twitch Drops';
  const description =
    status === 'failed'
      ? hasCachedCampaigns
        ? 'Could not update. Old data is still shown.'
        : 'Could not update yet. No campaign data is shown.'
      : status === 'stale'
        ? 'Checking Twitch for fresh campaigns…'
        : status === 'syncing'
          ? 'Updating Twitch Drops and campaigns…'
          : 'Open Twitch Drops so DropHunter can detect available campaigns.';
  const detail =
    status === 'failed' && error
      ? error
      : status === 'empty' && !lastUpdated
        ? 'Not synced yet'
        : formatLastUpdated(lastUpdated);
  const buttonLabel = isEmpty ? 'Go to Drops' : 'Open Twitch Drops';

  return (
    <section
      className={`glass rounded-lg p-3 border ${panelTone}`}
      aria-live="polite"
      aria-busy={isSyncing}
      aria-label="Campaign sync status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-gray-300">{description}</p>
          <p className="mt-1 text-[11px] text-gray-500 break-words">{detail}</p>
        </div>
        {isSyncing || status === 'stale' ? (
          <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent shrink-0 mt-0.5" />
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-twitch-purple/80 hover:bg-twitch-purple px-3 py-1.5 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          >
            <DropsIcon size={14} />
            {buttonLabel}
          </button>
        )}
      </div>
    </section>
  );
}
