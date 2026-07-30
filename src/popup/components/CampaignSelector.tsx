import type { TwitchGame } from '../../types';
import { formatCampaignOptionLabel, isCampaignFarmable } from '../format';
import { queueGameIdentity } from '../queue-start';
import { BackIcon } from './icons';

export interface CampaignSelectorProps {
  selectedGame: TwitchGame | null;
  sortedGames: TwitchGame[];
  queueGames: TwitchGame[];
  actionLoading: boolean;
  highlighted: boolean;
  onSelectGame: (gameId: string) => void;
  onAddToQueue: () => void;
}

export function CampaignSelector({
  selectedGame,
  sortedGames,
  queueGames,
  actionLoading,
  highlighted,
  onSelectGame,
  onAddToQueue,
}: CampaignSelectorProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <select
          aria-label="Campaign"
          value={selectedGame ? queueGameIdentity(selectedGame) : ''}
          onChange={(event) => onSelectGame(event.target.value)}
          className={`dh-input min-h-8 w-full appearance-none rounded-lg py-1.5 pr-8 pl-2 text-xs [&>option]:bg-twitch-dark [&>option]:text-[color:var(--dh-text)] ${highlighted ? 'onboarding-pulse' : ''}`}
        >
          <option value="">Select a campaign to start</option>
          {sortedGames.map((game) => (
            <option key={queueGameIdentity(game)} value={queueGameIdentity(game)}>
              {formatCampaignOptionLabel(game, queueGames)}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[color:var(--dh-muted)]">
          <span className="-rotate-90">
            <BackIcon />
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={onAddToQueue}
        disabled={!selectedGame || actionLoading || !isCampaignFarmable(selectedGame)}
        className="dh-action-secondary dh-focus min-h-8 shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-55"
        aria-label="Add selected campaign to queue"
      >
        Queue
      </button>
    </div>
  );
}
