import { useCallback, useEffect, useMemo, useState } from 'react';
import { sendRuntimeMessage } from '../../shared/messages.ts';
import type { ClaimLogEntry } from '../../types/index.ts';
import { formatClaimedAt, rewardInitials } from '../format.ts';
import { useVirtualRows } from '../hooks/useVirtualRows.ts';
import { BackIcon } from './icons.tsx';

const LIST_HEIGHT_PX = 440;
const HEADER_ROW_HEIGHT = 28;
const ENTRY_ROW_HEIGHT = 44;

type ClaimLogRow =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'entry'; key: string; entry: ClaimLogEntry };

function groupKey(entry: ClaimLogEntry): string {
  return entry.campaignId ? `campaign:${entry.campaignId}` : `game:${entry.gameId || entry.gameName}`;
}

function buildRows(entries: ClaimLogEntry[]): ClaimLogRow[] {
  const groups = new Map<string, { label: string; entries: ClaimLogEntry[]; maxAt: number }>();
  for (const entry of entries) {
    const key = groupKey(entry);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      if (entry.claimedAt > existing.maxAt) {
        existing.maxAt = entry.claimedAt;
        existing.label = entry.campaignLabel;
      }
    } else {
      groups.set(key, { label: entry.campaignLabel, entries: [entry], maxAt: entry.claimedAt });
    }
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].maxAt - a[1].maxAt);
  const rows: ClaimLogRow[] = [];
  for (const [key, group] of sorted) {
    rows.push({ kind: 'header', key, label: group.label, count: group.entries.length });
    const sortedEntries = [...group.entries].sort((a, b) => b.claimedAt - a.claimedAt);
    for (const entry of sortedEntries) {
      rows.push({ kind: 'entry', key: `entry:${entry.id}`, entry });
    }
  }
  return rows;
}

function getRowHeight(row: ClaimLogRow): number {
  return row.kind === 'header' ? HEADER_ROW_HEIGHT : ENTRY_ROW_HEIGHT;
}

function CampaignHeaderRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-3 h-full bg-[color:var(--dh-surface-3)]">
      <span className="text-[11px] font-semibold text-purple-300/90 truncate">{label}</span>
      <span className="ml-2 shrink-0 rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
        {count}
      </span>
    </div>
  );
}

function RewardThumb({ imageUrl, name }: { imageUrl?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-7 w-7 shrink-0 rounded-md object-cover bg-purple-500/20"
      />
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-500/20 text-[10px] font-bold text-purple-300">
      {rewardInitials(name)}
    </div>
  );
}

function ClaimLogEntryRow({ entry }: { entry: ClaimLogEntry }) {
  const showBenefit = entry.benefitName && entry.benefitName !== entry.dropName;
  return (
    <div className="flex items-center gap-2.5 px-3 h-full">
      <RewardThumb imageUrl={entry.imageUrl} name={entry.dropName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[color:var(--dh-text)] leading-tight">
          {entry.dropName}
          {showBenefit && <span className="text-[color:var(--dh-muted)]"> · {entry.benefitName}</span>}
        </p>
        <p className="dh-faint text-[10px] leading-tight mt-0.5">{formatClaimedAt(entry.claimedAt)}</p>
      </div>
    </div>
  );
}

export interface ClaimLogViewProps {
  onBack: () => void;
}

export function ClaimLogView({ onBack }: ClaimLogViewProps) {
  const [entries, setEntries] = useState<ClaimLogEntry[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sendRuntimeMessage({ type: 'GET_CLAIM_LOG' })
      .then((res) => {
        if (cancelled) return;
        if (res?.success) setEntries(res.entries ?? []);
        else setFetchError(res?.error ?? 'Could not load claim log.');
      })
      .catch(() => {
        if (!cancelled) setFetchError('Could not load claim log.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => (entries ? buildRows(entries) : []), [entries]);

  const campaignCount = useMemo(() => {
    if (!entries) return 0;
    return new Set(entries.map(groupKey)).size;
  }, [entries]);

  const getRowHeightCb = useCallback(getRowHeight, []);
  const { totalHeight, visibleRows, onScroll } = useVirtualRows({
    rows,
    getRowHeight: getRowHeightCb,
    viewportHeight: LIST_HEIGHT_PX,
  });

  const handleClear = async () => {
    if (!clearPending) {
      setClearPending(true);
      setTimeout(() => setClearPending(false), 4000);
      return;
    }
    setClearPending(false);
    setClearError(null);
    try {
      const res = await sendRuntimeMessage({ type: 'CLEAR_CLAIM_LOG' });
      if (res?.success) {
        setEntries([]);
      } else {
        setClearError(res?.error ?? 'Could not clear log.');
      }
    } catch {
      setClearError('Could not clear log.');
    }
  };

  return (
    <div className="flex flex-col">
      <div className="dh-header flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="dh-icon-button dh-focus text-[color:var(--dh-accent-ink)]"
            aria-label="Back to settings"
            title="Back"
          >
            <BackIcon />
          </button>
          <h1 className="font-extrabold text-sm text-[color:var(--dh-accent-ink)]">
            Drop &amp; Campaign Log
          </h1>
        </div>
        <span className="dh-header-label text-[10px] font-semibold uppercase tracking-[0.14em]">
          DropHunter
        </span>
      </div>

      <div className="dh-view dh-page dh-page--wide">
        <div className="dh-panel dh-contain overflow-hidden">
          {entries !== null && entries.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--dh-border)]">
              <p className="dh-copy text-[11px]">
                {entries.length} {entries.length === 1 ? 'drop' : 'drops'} · {campaignCount}{' '}
                {campaignCount === 1 ? 'campaign' : 'campaigns'}
              </p>
              <div className="flex items-center gap-2">
                {clearError && <span className="text-[10px] text-red-400">{clearError}</span>}
                <button
                  type="button"
                  onClick={() => void handleClear()}
                  aria-label={clearPending ? 'Confirm clearing claim log' : 'Clear claim log'}
                  className={`dh-focus rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
                    clearPending
                      ? 'text-red-400 hover:text-red-300 bg-red-500/10'
                      : 'text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]'
                  }`}
                >
                  {clearPending ? 'Confirm clear' : 'Clear'}
                </button>
              </div>
            </div>
          )}

          {entries === null && !fetchError && (
            <div
              role="status"
              aria-live="polite"
              className="dh-copy flex items-center justify-center py-10 gap-2 text-xs"
            >
              <div className="spinner rounded-full h-4 w-4 border-[2px] border-twitch-purple border-t-transparent" />
              Loading…
            </div>
          )}

          {fetchError && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center py-10 text-red-400 text-xs px-4 text-center"
            >
              {fetchError}
            </div>
          )}

          {entries !== null && entries.length === 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center justify-center py-10 gap-1 px-4 text-center"
            >
              <p className="text-sm text-[color:var(--dh-text-soft)] font-semibold">No drops claimed yet.</p>
              <p className="dh-faint text-[11px]">Claimed drops will appear here.</p>
            </div>
          )}

          {entries !== null && entries.length > 0 && (
            <div className="overflow-y-auto" style={{ height: LIST_HEIGHT_PX }} onScroll={onScroll}>
              <ul
                aria-label="Claimed drops by campaign"
                style={{
                  height: totalHeight,
                  position: 'relative',
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                }}
              >
                {visibleRows.map(({ row, top, height }) => (
                  <li key={row.key} style={{ position: 'absolute', top, left: 0, right: 0, height }}>
                    {row.kind === 'header' ? (
                      <CampaignHeaderRow label={row.label} count={row.count} />
                    ) : (
                      <ClaimLogEntryRow entry={row.entry} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
