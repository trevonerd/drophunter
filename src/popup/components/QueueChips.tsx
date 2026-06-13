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
      <span className="dh-faint text-[11px]">Queue</span>
      {selectedNotInQueue && (
        <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-green-500/40 bg-green-700/45 px-2 py-0.5 text-[11px] text-green-200">
          {selectedGame.allDropsCompleted ? '✅ ' : ''}
          <span className="truncate">{getGameDisplayLabel(selectedGame)}</span>
          <span className="ml-1 text-green-400/80">↑ first</span>
        </span>
      )}
      {queueGames.map((game) => (
        <span
          key={queueGameIdentity(game)}
          className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-[color:var(--dh-surface-3)] px-2 py-0.5 text-[11px] text-[color:var(--dh-text-soft)]"
        >
          {game.allDropsCompleted ? '✅ ' : ''}
          <span className="truncate">{getGameDisplayLabel(game)}</span>
          {!isRunning && (
            <button
              type="button"
              onClick={() => onRemove(game)}
              className="dh-focus ml-0.5 rounded text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
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
          className="dh-focus rounded px-1 text-[11px] text-red-400 hover:text-red-300"
          aria-label="Clear queue"
        >
          Clear
        </button>
      )}
    </div>
  );
}
