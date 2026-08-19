import type { CampaignPriorityMode, QueueEntryMetadata, TwitchGame } from '../../types';
import { getCampaignIndicatorKinds, getCampaignStatusLines } from '../format';
import { CampaignStatusIndicators } from './CampaignStatusIndicators';
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

export function SelectedCampaignStatus({ selectedGame }: { readonly selectedGame: TwitchGame | null }) {
  if (!selectedGame) return null;

  const statusLines = getCampaignStatusLines(selectedGame);
  const hasStatus = statusLines.length > 0 || getCampaignIndicatorKinds(selectedGame).length > 0;
  if (!hasStatus) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex min-w-0 items-start gap-1.5 text-[11px]"
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
