import { type ReactNode, useEffect, useState } from 'react';
import { isFavoriteGame, isHiddenGame } from '../../shared/game-selection';
import type { CampaignPriorityMode, GamePreference, TwitchDrop, TwitchGame } from '../../types';
import type { CampaignProgressLookup } from './campaign-list-model';
import { GameCampaignGroup } from './GameCampaignGroup';
import { EyeOffIcon } from './icons';
import { OtherDropsDisclosure } from './OtherDropsDisclosure';
import { useCampaignListState } from './useCampaignListState';

export type {
  CampaignProgressLookup,
  CampaignProgressSummary,
} from './campaign-list-model';
export { resolveStoredCatalogFilter, shouldShowOtherDrops } from './useCampaignListState';

export interface CampaignListProps {
  readonly campaigns: readonly TwitchGame[];
  readonly drops?: readonly TwitchDrop[];
  readonly favoriteGameIds?: ReadonlySet<string> | readonly string[];
  readonly hiddenGameIds?: ReadonlySet<string> | readonly string[];
  readonly queueGames?: readonly TwitchGame[];
  readonly loadedCampaignKeys?: ReadonlySet<string> | readonly string[];
  readonly refreshInProgress?: boolean;
  readonly refreshStartedAt?: number | null;
  readonly progressByCampaignKey?: CampaignProgressLookup;
  readonly priorityMode?: CampaignPriorityMode;
  readonly highlightedCampaignKey?: string | null;
  readonly actionLoading?: boolean;
  readonly now?: number;
  readonly runningGame?: TwitchGame | null;
  readonly beforeCatalog?: ReactNode;
  readonly onOpenTwitchDrops?: () => void;
  readonly onSetFavorite?: (game: TwitchGame, favorite: boolean) => void;
  readonly onSetGamePreference?: (
    game: TwitchGame,
    preference: GamePreference,
  ) => Promise<boolean> | undefined;
  readonly onAddToQueue?: (game: TwitchGame) => void;
  readonly onAddAllToQueue?: (games: readonly TwitchGame[]) => void;
  readonly onRemoveFromQueue?: (game: TwitchGame) => void;
  readonly onLinkAccount?: (game: TwitchGame) => void;
}

function favoriteIdSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> {
  return value instanceof Set ? value : new Set(value ?? []);
}

export function CampaignList({
  campaigns,
  drops = [],
  favoriteGameIds,
  hiddenGameIds,
  queueGames = [],
  loadedCampaignKeys,
  refreshInProgress = false,
  refreshStartedAt = null,
  progressByCampaignKey,
  priorityMode,
  highlightedCampaignKey = null,
  actionLoading = false,
  now = Date.now(),
  runningGame = null,
  beforeCatalog,
  onOpenTwitchDrops,
  onSetFavorite,
  onSetGamePreference,
  onAddToQueue,
  onAddAllToQueue,
  onRemoveFromQueue,
  onLinkAccount,
}: CampaignListProps) {
  const {
    query,
    setQuery,
    sortMode,
    updateSortMode,
    filter,
    updateFilter,
    catalogFeedback,
    undoButtonRef,
    filterSelectRef,
    undoPreference,
    activeHighlightKey,
    expandedGameKey,
    toggleGame,
    favorites,
    hidden,
    groups,
    unmatchedDrops,
    orderLabel,
    filterLabel,
    showOtherDrops,
    visibleCampaignCount,
    handlePreference,
  } = useCampaignListState({
    campaigns,
    drops,
    favoriteGameIds,
    hiddenGameIds,
    progressByCampaignKey,
    priorityMode,
    highlightedCampaignKey,
    onSetFavorite,
    onSetGamePreference,
  });
  const loadedKeys = favoriteIdSet(loadedCampaignKeys);
  const [refreshNow, setRefreshNow] = useState(() => Date.now());
  useEffect(() => {
    if (!refreshInProgress || !refreshStartedAt) return;
    const delay = Math.max(0, 15_000 - (Date.now() - refreshStartedAt));
    const timeout = window.setTimeout(() => setRefreshNow(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [refreshInProgress, refreshStartedAt]);
  const refreshDelayed =
    refreshInProgress && refreshStartedAt !== null && refreshNow - refreshStartedAt >= 15_000;

  return (
    <section aria-label="Campaigns" className="dh-group min-w-0">
      <div className="dh-campaign-browser-heading flex items-center justify-between gap-2">
        <h2 className="dh-title text-xs">Games and campaigns</h2>
        <span className="text-right text-[10px] text-[color:var(--dh-muted)]">
          {groups.length} games · {visibleCampaignCount} campaigns
          <span className="block">Sorted: {orderLabel}</span>
        </span>
      </div>
      {beforeCatalog}
      <div className="dh-catalog-toolbar flex min-w-0 items-center gap-1.5">
        <label className="sr-only" htmlFor="campaign-search">
          Search campaigns and Drops
        </label>
        <input
          id="campaign-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search games, campaigns or Drops"
          className="dh-input min-h-8 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs"
          aria-label="Search campaigns"
        />
        <label className="dh-catalog-tool dh-focus" title={`Sort: ${orderLabel}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M8 6h12M8 12h8M8 18h4M4 5v14m0 0-2-2m2 2 2-2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <select
            aria-label="Sort games"
            value={sortMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'ending-soonest' || value === 'lowest-availability' || value === 'alphabetical') {
                updateSortMode(value);
              }
            }}
          >
            <option value="ending-soonest">Expiring first</option>
            <option value="lowest-availability">Lowest availability</option>
            <option value="alphabetical">Alphabetical</option>
          </select>
        </label>
        <label className="dh-catalog-tool dh-focus" title={`Filter: ${filterLabel}`}>
          {filter === 'hidden-only' ? (
            <EyeOffIcon />
          ) : filter === 'favorites-only' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.53l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3Z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          <select
            aria-label="Filter games"
            ref={filterSelectRef}
            value={filter === 'all' ? 'available' : filter}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'available' || value === 'favorites-only' || value === 'hidden-only') {
                updateFilter(value);
              }
            }}
          >
            <option value="available">Available</option>
            <option value="favorites-only">Favorites</option>
            <option value="hidden-only">Hidden</option>
          </select>
        </label>
      </div>
      {catalogFeedback && (
        <p role="status" aria-live="polite" aria-atomic="true" className="dh-catalog-feedback">
          {catalogFeedback.message}{' '}
          <button
            type="button"
            ref={undoButtonRef}
            className="dh-focus underline underline-offset-2"
            onClick={undoPreference}
          >
            Undo
          </button>
        </p>
      )}
      {groups.length === 0 ? (
        <p className="dh-panel px-3 py-2.5 text-[11px] text-[color:var(--dh-muted)]" role="status">
          {campaigns.length === 0
            ? 'No campaigns available.'
            : query.trim() !== ''
              ? `No ${filterLabel.toLocaleLowerCase()} games match your search.`
              : filter === 'hidden-only'
                ? 'No hidden games.'
                : filter === 'favorites-only'
                  ? 'No favorite games.'
                  : 'No campaigns match your search.'}
        </p>
      ) : (
        <div>
          <ul className="space-y-2" aria-live="polite">
            {groups.map((group) => {
              const representative = group.campaigns[0];
              return (
                <GameCampaignGroup
                  key={group.key}
                  group={group}
                  allDrops={drops}
                  favorite={representative ? isFavoriteGame(representative, favorites) : false}
                  hidden={representative ? isHiddenGame(representative, hidden) : false}
                  queueGames={queueGames}
                  loadedCampaignKeys={loadedKeys}
                  refreshDelayed={refreshDelayed}
                  expanded={expandedGameKey === group.key}
                  progressByCampaignKey={progressByCampaignKey}
                  highlightedCampaignKey={activeHighlightKey}
                  actionLoading={actionLoading}
                  now={now}
                  runningGame={runningGame}
                  onToggleGame={toggleGame}
                  onSetGamePreference={(game, preference, undoPreference) =>
                    handlePreference(game, preference, undoPreference)
                  }
                  onSetFavorite={onSetFavorite}
                  onAddToQueue={onAddToQueue}
                  onAddAllToQueue={onAddAllToQueue}
                  onRemoveFromQueue={onRemoveFromQueue}
                  onLinkAccount={onLinkAccount}
                />
              );
            })}
          </ul>
          {showOtherDrops && (
            <OtherDropsDisclosure drops={unmatchedDrops} onOpenTwitchDrops={onOpenTwitchDrops} />
          )}
        </div>
      )}
    </section>
  );
}
