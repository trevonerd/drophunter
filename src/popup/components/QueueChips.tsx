// Extracted from src/popup/App.tsx (QueueChips component).
import { useEffect, useState } from 'react';
import { gameKey, getGameDisplayLabel, isFavoriteGame } from '../../shared/game-selection';
import type { CampaignPriorityMode, QueueEntryMetadata, TwitchGame } from '../../types';
import { useQueueDragReorder } from '../hooks/useQueueDragReorder';
import { isSameQueuedGame, queueGameIdentity } from '../queue-start';
import { CampaignStatusIndicators } from './CampaignStatusIndicators';
import { CloseIcon, GripIcon } from './icons';

const CLEAR_CONFIRM_TIMEOUT_MS = 3000;

export interface QueueChipsProps {
  selectedGame: TwitchGame | null;
  queueGames: TwitchGame[];
  isRunning: boolean;
  campaignPriorityMode?: CampaignPriorityMode;
  queueEntryMetadataByKey?: Readonly<Record<string, QueueEntryMetadata>>;
  favoriteGameIds?: ReadonlySet<string> | readonly string[];
  now?: number;
  onRemove: (game: TwitchGame) => void;
  onClear: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function QueueChips({
  selectedGame,
  queueGames,
  isRunning,
  queueEntryMetadataByKey = {},
  favoriteGameIds,
  now = Date.now(),
  onRemove,
  onClear,
  onReorder,
}: QueueChipsProps) {
  const visibleQueueGames =
    isRunning && selectedGame
      ? queueGames.filter((game) => !isSameQueuedGame(game, selectedGame))
      : queueGames;
  const canReorder = visibleQueueGames.length > 0;
  const requestReorder = (fromIndex: number, toIndex: number) => {
    const fromGame = visibleQueueGames[fromIndex];
    const toGame = visibleQueueGames[toIndex];
    if (!fromGame || !toGame) return;
    const storedFromIndex = queueGames.findIndex((game) => isSameQueuedGame(game, fromGame));
    const storedToIndex = queueGames.findIndex((game) => isSameQueuedGame(game, toGame));
    if (storedFromIndex < 0 || storedToIndex < 0 || storedFromIndex === storedToIndex) return;
    onReorder(storedFromIndex, storedToIndex);
  };
  const { dragIndex, dropIndex, handleDragStart, handleDragEnd, handleDragOver, handleDrop } =
    useQueueDragReorder(requestReorder);
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

  if (visibleQueueGames.length === 0) {
    return null;
  }

  const favorites = favoriteGameIds instanceof Set ? favoriteGameIds : new Set(favoriteGameIds ?? []);

  const formatEndsIn = (game: TwitchGame): string => {
    const relativeMs =
      typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)
        ? game.expiresInMs
        : game.endsAt
          ? Date.parse(game.endsAt) - now
          : Number.NaN;
    if (!Number.isFinite(relativeMs)) return 'Ends in unknown time';
    if (relativeMs <= 0) return 'Expired';
    const minutes = Math.max(1, Math.round(relativeMs / 60_000));
    if (minutes < 60) return `Ends in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return remainingMinutes ? `Ends in ${hours}h ${remainingMinutes}m` : `Ends in ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Ends in ${days}d`;
  };

  const provenanceLabel = (game: TwitchGame): string => {
    const metadata = queueEntryMetadataByKey[gameKey(game)];
    return metadata?.source === 'favorite-auto' ? 'Favorite · Added automatically' : 'Added manually';
  };

  return (
    <section className="dh-group" aria-labelledby="queued-campaigns-heading">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 id="queued-campaigns-heading" className="dh-title text-[11px]">
          Queued
        </h3>
        {!isRunning && (
          <button
            type="button"
            onClick={handleClearClick}
            className="dh-focus min-h-7 rounded px-2 text-[11px] text-red-400 hover:text-red-300"
            aria-label={confirmingClear ? 'Confirm clear queue' : 'Clear queue'}
          >
            {confirmingClear ? 'Confirm clear' : 'Clear'}
          </button>
        )}
      </div>
      <ol className="flex flex-col gap-1">
        {visibleQueueGames.map((game, index) => {
          const label = getGameDisplayLabel(game);
          const isDragging = dragIndex === index;
          const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <li
              key={queueGameIdentity(game)}
              onDragOver={canReorder ? handleDragOver(index) : undefined}
              onDrop={canReorder ? handleDrop(index) : undefined}
              className={`grid min-h-11 w-full grid-cols-[1.5rem_minmax(0,1fr)_auto_1.5rem] items-center gap-1.5 rounded-lg border border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] px-2 py-1.5 text-[11px] text-[color:var(--dh-text-soft)] ${
                isDragging ? 'opacity-60' : ''
              } ${isDropTarget ? 'ring-1 ring-[color:var(--dh-accent)]' : ''}`}
              data-queue-item="campaign"
              aria-label={`Queue position ${index + 1}: ${label}. ${provenanceLabel(game)}. ${formatEndsIn(game)}`}
            >
              {canReorder ? (
                <button
                  type="button"
                  draggable
                  onDragStart={handleDragStart(index)}
                  onDragEnd={handleDragEnd}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                      event.preventDefault();
                      if (index > 0) requestReorder(index, index - 1);
                    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      if (index < visibleQueueGames.length - 1) requestReorder(index, index + 1);
                    }
                  }}
                  className="dh-focus inline-flex h-6 w-6 cursor-grab items-center justify-center rounded text-[10px] text-[color:var(--dh-muted)] active:cursor-grabbing hover:text-[color:var(--dh-text)]"
                  aria-label={`Reorder ${label}. Use arrow keys to move.`}
                >
                  <GripIcon />
                </button>
              ) : (
                <span
                  className="inline-flex h-6 w-6 items-center justify-center text-[10px] font-semibold text-[color:var(--dh-muted)]"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate font-semibold leading-snug text-[color:var(--dh-text)]"
                  title={label}
                >
                  {label}
                </span>
                <span className="block truncate text-[10px] leading-snug text-[color:var(--dh-muted)]">
                  {provenanceLabel(game)} · {formatEndsIn(game)}
                </span>
              </span>
              <span className="flex min-w-0 items-center justify-end gap-1 overflow-hidden">
                {isFavoriteGame(game, favorites) && (
                  <span className="shrink-0 text-[color:var(--dh-warning)]" title="Favorite game">
                    ★
                  </span>
                )}
                <CampaignStatusIndicators game={game} />
              </span>
              <button
                type="button"
                onClick={() => onRemove(game)}
                className="dh-focus inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
                aria-label={`Remove ${label} from queue`}
              >
                <CloseIcon />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
