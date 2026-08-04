import { HistoryIcon } from './icons';

export function SettingsStatistics({
  dropsClaimed,
  channelPointsClaimed,
  onOpenClaimLog,
}: {
  readonly dropsClaimed: number;
  readonly channelPointsClaimed: number;
  readonly onOpenClaimLog: () => void;
}) {
  return (
    <div className="dh-panel dh-contain px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="dh-title text-xs">Statistics</p>
        <button
          type="button"
          onClick={onOpenClaimLog}
          aria-label="View drop claim log"
          title="Drop claim log"
          className="dh-icon-button dh-focus text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
        >
          <HistoryIcon />
        </button>
      </div>
      <div className="dh-stat-grid grid grid-cols-2 gap-2">
        <div className="dh-subpanel px-2.5 py-2">
          <p className="dh-copy text-[10px] uppercase tracking-wide">Drops claimed</p>
          <p className="mt-0.5 text-lg font-bold leading-none text-[color:var(--dh-text)]">{dropsClaimed}</p>
        </div>
        <div className="dh-subpanel px-2.5 py-2">
          <p className="dh-copy text-[10px] uppercase tracking-wide">Channel points claimed</p>
          <p className="mt-0.5 text-lg font-bold leading-none text-[color:var(--dh-text)]">
            {channelPointsClaimed}
          </p>
        </div>
      </div>
    </div>
  );
}
