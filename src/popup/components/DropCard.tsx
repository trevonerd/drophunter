// Extracted from src/popup/App.tsx (Compact Drop Image + Compact Drop Card).
import { type CSSProperties, useState } from 'react';
import type { TwitchDrop } from '../../types';
import { formatEtaMinutes, rewardInitials } from '../format';
import { SubIcon } from './icons';

function CompactDropImage({ drop }: { drop: TwitchDrop }) {
  const [hasError, setHasError] = useState(false);
  if (!drop.imageUrl || hasError) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] text-[9px] font-bold text-[color:var(--dh-text-soft)]">
        {rewardInitials(drop.name)}
      </div>
    );
  }
  return (
    <img
      src={drop.imageUrl}
      alt={drop.name}
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded object-cover bg-[color:var(--dh-surface-3)]"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
    />
  );
}

export function CompactDropCard({ drop }: { drop: TwitchDrop }) {
  const isEventBased = drop.dropType === 'event-based';
  const eta = formatEtaMinutes(drop.remainingMinutes);
  let statusText: string;
  let statusClass: string;

  if (drop.claimed) {
    statusText = 'Claimed';
    statusClass = 'text-green-400';
  } else if (drop.claimable) {
    statusText = 'Claimable';
    statusClass = 'text-yellow-300 font-bold';
  } else if (isEventBased) {
    statusText = 'Sub only';
    statusClass = 'text-orange-400';
  } else if (drop.status === 'active') {
    statusText = 'Active';
    statusClass = 'text-blue-300';
  } else {
    statusText = 'Pending';
    statusClass = 'dh-copy';
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2${isEventBased && !drop.claimed ? ' opacity-60' : ''}`}
    >
      <CompactDropImage drop={drop} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-[color:var(--dh-text)]">
            {isEventBased && (
              <span className="text-orange-400 inline-flex align-middle mr-1">
                <SubIcon />
              </span>
            )}
            {drop.name}
          </p>
          <span className="shrink-0 whitespace-nowrap text-right text-[11px]">
            <span className={statusClass}>{statusText}</span>
            {!isEventBased && <span className="dh-faint"> · {drop.progress}%</span>}
            {!isEventBased && eta && !drop.claimed && !drop.claimable && (
              <span className="dh-faint"> · ETA {eta}</span>
            )}
          </span>
        </div>
        {isEventBased ? (
          <p className="mt-1 text-[10px] text-orange-400/70">Subscribe to redeem</p>
        ) : (
          <div className="dh-progress-track mt-1 h-1 w-full overflow-hidden rounded-full">
            <div
              className={`dh-progress-fill h-1 w-full rounded-full ${
                drop.claimable ? 'dh-progress-fill--claimable' : ''
              }`}
              style={{ '--dh-progress': Math.max(0, Math.min(100, drop.progress)) / 100 } as CSSProperties}
            />
          </div>
        )}
      </div>
    </div>
  );
}
