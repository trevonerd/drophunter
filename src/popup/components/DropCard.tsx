// Extracted from src/popup/App.tsx (Compact Drop Image + Compact Drop Card).
import { type CSSProperties, useState } from 'react';
import { isRewardAcquired, isTwitchNativeAcquisitionUnverifiable } from '../../shared/reward-semantics';
import type { TwitchDrop } from '../../types';
import { formatEtaMinutes, rewardInitials } from '../format';
import { QuestionIcon, SubIcon } from './icons';

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
  const isAcquired = isRewardAcquired(drop);
  const isSubscription = drop.acquisitionMethod === 'subscription';
  const isUnverifiableTwitchReward = isTwitchNativeAcquisitionUnverifiable(drop);
  const eta = formatEtaMinutes(drop.remainingMinutes);
  let statusText: string;
  let statusClass: string;

  if (isAcquired) {
    statusText = 'Claimed';
    statusClass = 'text-green-400';
  } else if (drop.claimable) {
    statusText = 'Claimable';
    statusClass = 'text-yellow-300 font-bold';
  } else if (isSubscription) {
    statusText = 'Subscription required';
    statusClass = 'text-orange-400';
  } else if (isUnverifiableTwitchReward) {
    statusText = 'Unverifiable';
    statusClass = 'text-orange-400';
  } else if (drop.status === 'active') {
    statusText = 'Active';
    statusClass = 'text-blue-300';
  } else {
    statusText = 'Pending';
    statusClass = 'dh-copy';
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <CompactDropImage drop={drop} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-[color:var(--dh-text)]">
            {isSubscription && (
              <span className="text-orange-400 inline-flex align-middle mr-1">
                <SubIcon />
              </span>
            )}
            {isUnverifiableTwitchReward && (
              <span className="text-orange-400 inline-flex align-middle mr-1">
                <QuestionIcon />
              </span>
            )}
            {drop.name}
          </p>
          <span className="shrink-0 whitespace-nowrap text-right text-[11px]">
            <span className={statusClass}>{statusText}</span>
            {!isSubscription && <span className="dh-faint"> · {drop.progress}%</span>}
            {!isSubscription && !isUnverifiableTwitchReward && eta && !isAcquired && !drop.claimable && (
              <span className="dh-faint"> · ETA {eta}</span>
            )}
          </span>
        </div>
        {isSubscription ? (
          <p className="mt-1 text-[10px] text-orange-400">Subscribe to redeem this reward</p>
        ) : (
          <>
            {isUnverifiableTwitchReward && (
              <p className="mt-1 text-[10px] text-orange-400/70">
                Acquisition could not be verified on Twitch
              </p>
            )}
            <div className="dh-progress-track mt-1 h-1 w-full overflow-hidden rounded-full">
              <div
                className={`dh-progress-fill h-1 w-full rounded-full ${
                  drop.claimable ? 'dh-progress-fill--claimable' : ''
                }`}
                style={{ '--dh-progress': Math.max(0, Math.min(100, drop.progress)) / 100 } as CSSProperties}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
