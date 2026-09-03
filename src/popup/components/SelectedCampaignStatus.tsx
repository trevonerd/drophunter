import type { TwitchGame } from '../../types';
import { getCampaignIndicatorKinds, getCampaignStatusLines } from '../format';
import { CampaignStatusIndicators } from './CampaignStatusIndicators';

export function SelectedCampaignStatus({ selectedGame }: { readonly selectedGame: TwitchGame | null }) {
  if (!selectedGame) return null;

  const statusLines = getCampaignStatusLines(selectedGame);
  const hasStatus = statusLines.length > 0 || getCampaignIndicatorKinds(selectedGame).length > 0;
  if (!hasStatus) return null;

  return (
    <div
      data-session-campaign-notice="true"
      className="mt-1 flex min-w-0 items-start gap-1.5 text-[10px] leading-snug"
    >
      <CampaignStatusIndicators game={selectedGame} />
      <div className="min-w-0 flex-1 space-y-1">
        {statusLines.map((line) => (
          <p
            key={line.reason}
            data-campaign-status-reason={line.reason}
            className="w-full min-w-0 text-[color:var(--dh-text-soft)] [overflow-wrap:anywhere]"
          >
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}
