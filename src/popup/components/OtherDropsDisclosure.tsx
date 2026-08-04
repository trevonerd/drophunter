import type { TwitchDrop } from '../../types';
import { CompactDropCard } from './DropCard';

export function OtherDropsDisclosure({
  drops,
  onOpenTwitchDrops,
}: {
  readonly drops: readonly TwitchDrop[];
  readonly onOpenTwitchDrops?: () => void;
}) {
  if (drops.length === 0) return null;

  return (
    <details className="dh-panel mt-2 px-2 py-2" data-other-drops-count={drops.length}>
      <summary className="dh-focus cursor-pointer text-[10px] font-semibold text-[color:var(--dh-text-soft)]">
        Other Drops from Twitch ({drops.length})
      </summary>
      <p className="mt-1 text-[10px] leading-snug text-[color:var(--dh-muted)]">
        DropHunter keeps their progress, but cannot queue them until Twitch matches an active campaign.
      </p>
      <div className="mt-1 divide-y divide-[color:var(--dh-border)]">
        {drops.map((drop) => (
          <CompactDropCard key={`${drop.campaignId ?? drop.gameId}:${drop.id}`} drop={drop} />
        ))}
      </div>
      {onOpenTwitchDrops && (
        <button
          type="button"
          onClick={onOpenTwitchDrops}
          className="dh-focus mt-2 min-h-7 w-full rounded-lg border border-[color:var(--dh-border)] px-2 py-1 text-[11px] font-semibold text-[color:var(--dh-text-soft)]"
        >
          Open Twitch Drops
        </button>
      )}
    </details>
  );
}
