// Extracted from src/popup/App.tsx (RewardList component).
import { isRewardAutomatable } from '../../shared/reward-semantics';
import type { TwitchDrop } from '../../types';
import { CompactDropCard } from './DropCard';
import { CheckIcon, DropsIcon } from './icons';

export interface RewardListProps {
  pendingDrops: TwitchDrop[];
  completedDrops: TwitchDrop[];
  rewardsLoading: boolean;
  syncLoading: boolean;
  claimableCount: number;
  onOpenDropsPage?: () => void;
  hideEmptyPending?: boolean;
}

export function RewardList({
  pendingDrops,
  completedDrops,
  rewardsLoading,
  syncLoading,
  claimableCount,
  onOpenDropsPage,
  hideEmptyPending = false,
}: RewardListProps) {
  const isLoading = rewardsLoading || syncLoading;
  const showPendingGroup = isLoading || pendingDrops.length > 0 || !hideEmptyPending;
  const hasOnlyNonAutomatableRewards =
    pendingDrops.length > 0 && pendingDrops.every((drop) => !isRewardAutomatable(drop));
  const groupLabel = hasOnlyNonAutomatableRewards ? 'Remaining' : 'Pending';
  return (
    <>
      {showPendingGroup && (
        <div className={`dh-panel dh-contain ${syncLoading ? 'opacity-75' : ''}`}>
          <div className="px-3 py-2 flex items-center justify-between">
            <h2 className="dh-title text-xs">
              {groupLabel}
              {!isLoading && ` (${pendingDrops.length})`}
            </h2>
            <div className="flex items-center gap-1.5">
              {!isLoading && claimableCount > 0 && (
                <span className="text-[11px] text-yellow-300 font-medium">{claimableCount} claimable</span>
              )}
              {onOpenDropsPage && (
                <button
                  type="button"
                  onClick={onOpenDropsPage}
                  className="dh-icon-button dh-focus text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
                  aria-label="Open Twitch Drops"
                  title="Twitch Drops"
                >
                  <DropsIcon />
                </button>
              )}
            </div>
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
      )}

      {!syncLoading && completedDrops.length > 0 && (
        <details
          className="dh-panel dh-contain overflow-hidden text-xs"
          data-completed-reward-count={completedDrops.length}
        >
          <summary className="dh-focus cursor-pointer px-3 py-2 font-semibold text-green-400">
            Completed ({completedDrops.length})
          </summary>
          <ul className="divide-y divide-[color:var(--dh-border)] border-t border-[color:var(--dh-border)]">
            {completedDrops.map((drop) => (
              <li
                key={drop.id}
                className="flex min-w-0 items-center gap-2 px-3 py-2 text-[color:var(--dh-text-soft)]"
              >
                <span className="shrink-0 text-green-400">
                  <CheckIcon />
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{drop.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
