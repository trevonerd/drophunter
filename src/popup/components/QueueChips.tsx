// Extracted from src/popup/App.tsx (QueueChips component).
import { useEffect, useState } from 'react';
import { getGameDisplayLabel } from '../../shared/game-selection';
import type { TwitchGame } from '../../types';
import { isCampaignFarmable } from '../format';
import { useQueueDragReorder } from '../hooks/useQueueDragReorder';
import { isSameQueuedGame, queueGameIdentity } from '../queue-start';
import { CampaignStatusIndicators } from './CampaignStatusIndicators';
import { ArrowUpIcon, CloseIcon, GripIcon } from './icons';

const CLEAR_CONFIRM_TIMEOUT_MS = 3000;

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
  const visibleQueueGames =
    isRunning && selectedGame
      ? queueGames.filter((game) => !isSameQueuedGame(game, selectedGame))
      : queueGames;
  const canReorder = !isRunning && visibleQueueGames.length >= 2;
  const { dragIndex, dropIndex, handleDragStart, handleDragEnd, handleDragOver, handleDrop } =
    useQueueDragReorder(onReorder);
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    if (!confirmingClear) return;
    const timer = setTimeout(() => setConfirmingClear(false), CLEAR_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirmingClear]);

  const handleClearClick = () => {
    if (confirmingClear) {
      setConfirmingClear(false);
      onClear();
      return;
    }
    setConfirmingClear(true);
  };

  const selectedStartsBeforeQueue =
    !isRunning &&
    !!selectedGame &&
    isCampaignFarmable(selectedGame) &&
    queueGames.length > 0 &&
    !queueGames.some((g) => isSameQueuedGame(g, selectedGame));

  if (visibleQueueGames.length === 0 && !selectedStartsBeforeQueue) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      <span className="dh-faint text-[11px]">{isRunning ? 'Up next' : 'Queue'}</span>
      {selectedStartsBeforeQueue && (
        <span className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-green-500/40 bg-green-700/45 px-2 py-0.5 text-[11px] text-green-200">
          <CampaignStatusIndicators game={selectedGame} />
          <span className="min-w-0 truncate">{getGameDisplayLabel(selectedGame)}</span>
          <span className="ml-1 inline-flex items-center gap-0.5 text-green-400/80">
            <ArrowUpIcon />
            first
          </span>
        </span>
      )}
      <ul className="contents">
        {visibleQueueGames.map((game, index) => {
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
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                      event.preventDefault();
                      if (index > 0) onReorder(index, index - 1);
                    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      if (index < visibleQueueGames.length - 1) onReorder(index, index + 1);
                    }
                  }}
                  className="dh-focus -ml-0.5 cursor-grab rounded px-0.5 text-[10px] text-[color:var(--dh-muted)] active:cursor-grabbing hover:text-[color:var(--dh-text)]"
                  aria-label={`Reorder ${label}. Use arrow keys to move.`}
                >
                  <GripIcon />
                </button>
              )}
              <CampaignStatusIndicators game={game} />
              <span className="min-w-0 truncate">{label}</span>
              {!isRunning && (
                <button
                  type="button"
                  onClick={() => onRemove(game)}
                  className="dh-focus ml-0.5 rounded text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
                  aria-label={`Remove ${label} from queue`}
                >
                  <CloseIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!isRunning && (
        <button
          type="button"
          onClick={handleClearClick}
          className="dh-focus rounded px-1 text-[11px] text-red-400 hover:text-red-300"
          aria-label={confirmingClear ? 'Confirm clear queue' : 'Clear queue'}
        >
          {confirmingClear ? 'Confirm?' : 'Clear'}
        </button>
      )}
    </div>
  );
}
