// Extracted from src/popup/App.tsx (RewardList component).
import type { TwitchDrop } from '../../types';
import { CompactDropCard } from './DropCard';

export interface RewardListProps {
  pendingDrops: TwitchDrop[];
  completedDrops: TwitchDrop[];
  rewardsLoading: boolean;
  syncLoading: boolean;
  claimableCount: number;
}

export function RewardList({
  pendingDrops,
  completedDrops,
  rewardsLoading,
  syncLoading,
  claimableCount,
}: RewardListProps) {
  const isLoading = rewardsLoading || syncLoading;
  return (
    <>
      <div className={`dh-panel dh-contain ${syncLoading ? 'opacity-75' : ''}`}>
        <div className="px-3 py-2 flex items-center justify-between">
          <h3 className="dh-title text-xs">Pending{!isLoading && ` (${pendingDrops.length})`}</h3>
          {!isLoading && claimableCount > 0 && (
            <span className="text-[11px] text-yellow-300 font-medium">{claimableCount} claimable</span>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-3" aria-live="polite">
            <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent" />
            <p className="dh-copy text-xs">{syncLoading ? 'Updating rewards…' : 'Loading…'}</p>
          </div>
        ) : pendingDrops.length > 0 ? (
          <div className="max-h-[240px] overflow-y-auto divide-y divide-[color:var(--dh-border)]">
            {pendingDrops.map((drop) => (
              <CompactDropCard key={drop.id} drop={drop} />
            ))}
          </div>
        ) : (
          <p className="dh-faint px-3 py-3 text-xs">No pending rewards.</p>
        )}
      </div>

      {!syncLoading && completedDrops.length > 0 && (
        <p className="dh-faint px-1 text-[11px]">
          <span className="font-semibold text-green-400">Completed ({completedDrops.length})</span>{' '}
          {completedDrops.map((d) => `\u2713 ${d.name}`).join('  ')}
        </p>
      )}
    </>
  );
}
