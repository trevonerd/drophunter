import type { CampaignPriorityMode, QueueEntryMetadata, TwitchGame } from '../../types';
import { QueueChips } from './QueueChips';

export function CampaignQueueControls({
  selectedGame,
  queueGames,
  isRunning,
  campaignPriorityMode,
  queueEntryMetadataByKey,
  favoriteGameIds,
  now,
  queueMessage,
  onRemove,
  onClear,
  onReorder,
}: {
  readonly selectedGame: TwitchGame | null;
  readonly queueGames: TwitchGame[];
  readonly isRunning: boolean;
  readonly campaignPriorityMode: CampaignPriorityMode;
  readonly queueEntryMetadataByKey: Readonly<Record<string, QueueEntryMetadata>>;
  readonly favoriteGameIds: ReadonlySet<string>;
  readonly now: number;
  readonly queueMessage: string | null;
  readonly onRemove: (game: TwitchGame) => void;
  readonly onClear: () => void;
  readonly onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  return (
    <>
      {queueMessage && (
        <p role="status" aria-live="polite" aria-atomic="true" className="text-[11px] text-blue-300">
          {queueMessage}
        </p>
      )}
      <QueueChips
        selectedGame={selectedGame}
        queueGames={queueGames}
        isRunning={isRunning}
        campaignPriorityMode={campaignPriorityMode}
        queueEntryMetadataByKey={queueEntryMetadataByKey}
        favoriteGameIds={favoriteGameIds}
        now={now}
        onRemove={onRemove}
        onClear={onClear}
        onReorder={onReorder}
      />
    </>
  );
}
