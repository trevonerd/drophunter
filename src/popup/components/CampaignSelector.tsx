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
        className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs text-white bg-[#1F1F23] focus:outline-none focus:ring-2 focus:ring-twitch-purple [&>option]:bg-[#1F1F23] [&>option]:text-white ${onboardingStep === 'selector' ? 'onboarding-pulse' : ''}`}
        disabled={isRunning}
      >
        <option value="">Select a game to start</option>
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
          className="shrink-0 rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-semibold disabled:opacity-50 disabled:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          aria-label="Add selected campaign to queue"
        >
          +Queue
        </button>
      )}
    </div>
  );
}
