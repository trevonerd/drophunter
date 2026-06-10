// Extracted from src/popup/App.tsx (QueueChips component).
import { getGameDisplayLabel } from '../../shared/game-selection';
import type { TwitchGame } from '../../types';
import { isSameQueuedGame, queueGameIdentity } from '../queue-start';

export interface QueueChipsProps {
  selectedGame: TwitchGame | null;
  queueGames: TwitchGame[];
  isRunning: boolean;
  onRemove: (game: TwitchGame) => void;
  onClear: () => void;
}

export function QueueChips({ selectedGame, queueGames, isRunning, onRemove, onClear }: QueueChipsProps) {
  const selectedNotInQueue =
    !isRunning &&
    !!selectedGame &&
    queueGames.length > 0 &&
    !queueGames.some((g) => isSameQueuedGame(g, selectedGame));

  if (queueGames.length === 0 && !selectedNotInQueue) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="text-[11px] text-gray-500">Queue:</span>
      {selectedNotInQueue && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-green-700/60 border border-green-500/40 px-2 py-0.5 text-[11px] text-green-200">
          {selectedGame.allDropsCompleted ? '✅ ' : ''}
          {getGameDisplayLabel(selectedGame)}
          <span className="ml-1 text-green-400/80">↑ first</span>
        </span>
      )}
      {queueGames.map((game) => (
        <span
          key={queueGameIdentity(game)}
          className="inline-flex items-center gap-0.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-200"
        >
          {game.allDropsCompleted ? '✅ ' : ''}
          {getGameDisplayLabel(game)}
          {!isRunning && (
            <button
              type="button"
              onClick={() => onRemove(game)}
              className="ml-0.5 rounded text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
              aria-label={`Remove ${getGameDisplayLabel(game)} from queue`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!isRunning && (
        <button
          type="button"
          onClick={onClear}
          className="rounded text-[11px] text-red-400 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
          aria-label="Clear queue"
        >
          Clear
        </button>
      )}
    </div>
  );
}
