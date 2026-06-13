// Extracted from src/popup/App.tsx (CampaignSelector component).
import { getGameDisplayLabel } from '../../shared/game-selection';
import type { TwitchGame } from '../../types';
import { expiryLabel } from '../format';
import { queueGameIdentity } from '../queue-start';

export interface CampaignSelectorProps {
  selectedGame: TwitchGame | null;
  sortedGames: TwitchGame[];
  isRunning: boolean;
  actionLoading: boolean;
  onboardingStep: 'selector' | 'start' | null;
  onSelect: (gameId: string) => void;
  onAddToQueue: () => void;
}

export function CampaignSelector({
  selectedGame,
  sortedGames,
  isRunning,
  actionLoading,
  onboardingStep,
  onSelect,
  onAddToQueue,
}: CampaignSelectorProps) {
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Campaign"
        value={selectedGame ? queueGameIdentity(selectedGame) : ''}
        onChange={(e) => onSelect(e.target.value)}
        className={`dh-input min-h-8 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs [&>option]:bg-twitch-dark [&>option]:text-[color:var(--dh-text)] ${onboardingStep === 'selector' ? 'onboarding-pulse' : ''}`}
        disabled={isRunning}
      >
        <option value="">Select a campaign to start</option>
        {sortedGames.map((game) => (
          <option key={queueGameIdentity(game)} value={queueGameIdentity(game)}>
            {game.allDropsCompleted ? '\u2705 ' : game.isConnected === false ? '\u{1F512} ' : ''}
            {getGameDisplayLabel(game)} · {expiryLabel(game.expiryStatus)}
          </option>
        ))}
      </select>
      {!isRunning && (
        <button
          type="button"
          onClick={onAddToQueue}
          disabled={!selectedGame || actionLoading}
          className="dh-action-secondary dh-focus min-h-8 shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-55"
          aria-label="Add selected campaign to queue"
        >
          Queue
        </button>
      )}
    </div>
  );
}
