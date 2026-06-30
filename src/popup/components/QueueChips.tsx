// Extracted from src/popup/App.tsx (QueueChips component).
import { getGameDisplayLabel } from '../../shared/game-selection';
import type { TwitchGame } from '../../types';
import { useQueueDragReorder } from '../hooks/useQueueDragReorder';
import { isSameQueuedGame, queueGameIdentity } from '../queue-start';

export interface QueueChipsProps {
  selectedGame: TwitchGame | null;
  queueGames: TwitchGame[];
  isRunning: boolean;
  onRemove: (game: TwitchGame) => void;
  onClear: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function QueueChips({
  selectedGame,
  queueGames,
  isRunning,
  onRemove,
  onClear,
  onReorder,
}: QueueChipsProps) {
  const canReorder = !isRunning && queueGames.length >= 2;
  const { dragIndex, dropIndex, handleDragStart, handleDragEnd, handleDragOver, handleDrop } =
    useQueueDragReorder(onReorder);

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
      <ul className="contents">
        {queueGames.map((game, index) => {
          const label = getGameDisplayLabel(game);
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <li
              key={queueGameIdentity(game)}
              onDragOver={canReorder ? handleDragOver(index) : undefined}
              onDrop={canReorder ? handleDrop(index) : undefined}
              className={`inline-flex max-w-full items-center gap-0.5 rounded-full bg-[color:var(--dh-surface-3)] px-2 py-0.5 text-[11px] text-[color:var(--dh-text-soft)] ${
                isDragging ? 'opacity-60' : ''
              } ${isDropTarget ? 'ring-1 ring-[color:var(--dh-accent)]' : ''}`}
            >
              {canReorder && (
                <button
                  type="button"
                  draggable
                  onDragStart={handleDragStart(index)}
                  onDragEnd={handleDragEnd}
                  className="dh-focus -ml-0.5 cursor-grab rounded px-0.5 text-[10px] text-[color:var(--dh-muted)] active:cursor-grabbing hover:text-[color:var(--dh-text)]"
                  aria-label={`Reorder ${label}`}
                >
                  ⠿
                </button>
              )}
              {game.allDropsCompleted ? '✅ ' : ''}
              <span className="truncate">{label}</span>
              {!isRunning && (
                <button
                  type="button"
                  onClick={() => onRemove(game)}
                  className="dh-focus ml-0.5 rounded text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
                  aria-label={`Remove ${label} from queue`}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
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
