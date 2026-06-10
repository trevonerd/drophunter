// Extracted from src/popup/App.tsx (Compact Drop Image + Compact Drop Card).
import { useState } from 'react';
import type { TwitchDrop } from '../../types';
import { formatEtaMinutes, rewardInitials } from '../format';
import { SubIcon } from './icons';

function CompactDropImage({ drop }: { drop: TwitchDrop }) {
  const [hasError, setHasError] = useState(false);
  if (!drop.imageUrl || hasError) {
    return (
      <div className="w-8 h-8 rounded border border-white/10 bg-gray-800/70 flex items-center justify-center text-[9px] font-bold text-gray-300 shrink-0">
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
      className="w-8 h-8 rounded object-cover bg-gray-900/60 shrink-0"
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
    statusText = 'Claim!';
    statusClass = 'text-yellow-300 font-bold';
  } else if (isEventBased) {
    statusText = 'Sub Only';
    statusClass = 'text-orange-400';
  } else if (drop.status === 'active') {
    statusText = 'Active';
    statusClass = 'text-blue-300';
  } else {
    statusText = 'Pending';
    statusClass = 'text-gray-400';
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2${isEventBased && !drop.claimed ? ' opacity-60' : ''}`}
    >
      <CompactDropImage drop={drop} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-medium text-white truncate">
            {isEventBased && (
              <span className="text-orange-400 inline-flex align-middle mr-1">
                <SubIcon />
              </span>
            )}
            {drop.name}
          </p>
          <span className="text-[11px] whitespace-nowrap shrink-0">
            <span className={statusClass}>{statusText}</span>
            {!isEventBased && <span className="text-gray-500"> · {drop.progress}%</span>}
            {!isEventBased && eta && !drop.claimed && !drop.claimable && (
              <span className="text-gray-500"> · ETA {eta}</span>
            )}
          </span>
        </div>
        {isEventBased ? (
          <p className="mt-1 text-[10px] text-orange-400/70">Subscribe to redeem</p>
        ) : (
          <div className="mt-1 h-1 w-full rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-1 rounded-full transition-[width] duration-500 ${
                drop.claimable ? 'bg-yellow-400' : 'bg-gradient-to-r from-twitch-purple to-pink-500'
              }`}
              style={{ width: `${drop.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
