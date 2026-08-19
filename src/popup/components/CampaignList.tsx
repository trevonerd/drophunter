import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { dropMatchesGame, isFavoriteGame, isHiddenGame } from '../../shared/game-selection';
import type { CampaignPriorityMode, GamePreference, TwitchDrop, TwitchGame } from '../../types';
import {
  type CampaignCatalogFilter,
  type CampaignCatalogSortMode,
  type CampaignProgressLookup,
  groupCampaigns,
  sortCampaignGroups,
} from './campaign-list-model';
import { GameCampaignGroup } from './GameCampaignGroup';
import { EyeOffIcon } from './icons';
import { OtherDropsDisclosure } from './OtherDropsDisclosure';

export type {
  CampaignProgressLookup,
  CampaignProgressSummary,
} from './campaign-list-model';

export interface CampaignListProps {
  readonly campaigns: readonly TwitchGame[];
  readonly drops?: readonly TwitchDrop[];
  readonly favoriteGameIds?: ReadonlySet<string> | readonly string[];
  readonly hiddenGameIds?: ReadonlySet<string> | readonly string[];
  readonly queueGames?: readonly TwitchGame[];
  readonly loadedCampaignKeys?: ReadonlySet<string> | readonly string[];
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

const CATALOG_PREFERENCES_KEY = 'campaignCatalogPreferences';

function initialSortMode(priorityMode: CampaignPriorityMode | undefined): CampaignCatalogSortMode {
  return priorityMode === 'lowest-availability' ? 'lowest-availability' : 'ending-soonest';
}

function isCatalogSortMode(value: unknown): value is CampaignCatalogSortMode {
  return value === 'ending-soonest' || value === 'lowest-availability' || value === 'alphabetical';
}

function isCatalogFilter(value: unknown): value is CampaignCatalogFilter {
  return value === 'available' || value === 'favorites-only' || value === 'hidden-only' || value === 'all';
}

function favoriteIdSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> {
  return value instanceof Set ? value : new Set(value ?? []);
}

export function shouldShowOtherDrops(
  filter: CampaignCatalogFilter,
  query: string,
  resultCount: number,
): boolean {
  return (filter === 'available' || filter === 'all') && query.trim() === '' && resultCount > 0;
}

export function CampaignList({
  campaigns,
  drops = [],
  favoriteGameIds,
  hiddenGameIds,
  queueGames = [],
  loadedCampaignKeys,
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
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<CampaignCatalogSortMode>(() => initialSortMode(priorityMode));
  const [filter, setFilter] = useState<CampaignCatalogFilter>('available');
  const [catalogFeedback, setCatalogFeedback] = useState<{
    readonly message: string;
    readonly game: TwitchGame;
    readonly undoPreference: GamePreference;
    readonly focusUndo: boolean;
  } | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const filterSelectRef = useRef<HTMLSelectElement>(null);
  const [activeHighlightKey, setActiveHighlightKey] = useState(highlightedCampaignKey);
  const [expandedGameKey, setExpandedGameKey] = useState<string | null>(null);

  useEffect(() => {
    setActiveHighlightKey(highlightedCampaignKey);
    if (!highlightedCampaignKey) return;
    const timeout = globalThis.setTimeout(() => setActiveHighlightKey(null), 180);
    return () => globalThis.clearTimeout(timeout);
  }, [highlightedCampaignKey]);

  useEffect(() => {
    browser.storage.local
      .get([CATALOG_PREFERENCES_KEY])
      .then((stored) => {
        const preferences = stored[CATALOG_PREFERENCES_KEY];
        if (!preferences || typeof preferences !== 'object') return;
        const record = preferences as Record<string, unknown>;
        if (isCatalogSortMode(record.sortMode)) setSortMode(record.sortMode);
        if (isCatalogFilter(record.filter)) setFilter(record.filter === 'all' ? 'available' : record.filter);
      })
      .catch(() => undefined);
  }, []);

  const favorites = useMemo(() => favoriteIdSet(favoriteGameIds), [favoriteGameIds]);
  const hidden = useMemo(() => favoriteIdSet(hiddenGameIds), [hiddenGameIds]);
  const loadedKeys = favoriteIdSet(loadedCampaignKeys);
  const groups = useMemo(() => {
    const grouped = groupCampaigns(campaigns, drops, query).filter((group) => {
      const representative = group.campaigns[0];
      if (!representative) return false;
      const isHidden = isHiddenGame(representative, hidden);
      if (filter === 'available' || filter === 'all') return !isHidden;
      if (filter === 'hidden-only') return isHidden;
      return !isHidden && isFavoriteGame(representative, favorites);
    });
    return sortCampaignGroups(grouped, sortMode, progressByCampaignKey);
  }, [campaigns, drops, favorites, filter, hidden, progressByCampaignKey, query, sortMode]);
  const unmatchedDrops = useMemo(
    () => drops.filter((drop) => !campaigns.some((campaign) => dropMatchesGame(drop, campaign))),
    [campaigns, drops],
  );
  const orderLabel =
    sortMode === 'ending-soonest'
      ? 'Expiring first'
      : sortMode === 'lowest-availability'
        ? 'Lowest availability'
        : 'Alphabetical';
  const savePreferences = (nextSort: CampaignCatalogSortMode, nextFilter: CampaignCatalogFilter) => {
    void browser.storage.local
      .set({ [CATALOG_PREFERENCES_KEY]: { sortMode: nextSort, filter: nextFilter } })
      .catch(() => undefined);
  };
  const handlePreference = async (
    game: TwitchGame,
    preference: GamePreference,
    undoPreference: GamePreference,
  ) => {
    const focusUndo =
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains('dh-game-hide-action');
    let result = false;
    if (onSetGamePreference) {
      result = (await onSetGamePreference(game, preference)) ?? false;
    } else if (preference === 'favorite' || preference === 'normal') {
      onSetFavorite?.(game, preference === 'favorite');
      result = true;
    }
    if (result === false) {
      if (focusUndo) globalThis.setTimeout(() => filterSelectRef.current?.focus(), 0);
      return;
    }
    const label = game.name;
    const message =
      preference === 'hidden'
        ? `${label} hidden from Available games.`
        : preference === 'favorite'
          ? `${label} restored to Favorites.`
          : `${label} restored to Available games.`;
    setCatalogFeedback({ message, game, undoPreference, focusUndo });
  };
  useEffect(() => {
    if (!catalogFeedback) return;
    if (catalogFeedback.focusUndo) undoButtonRef.current?.focus();
    const timeout = globalThis.setTimeout(() => setCatalogFeedback(null), 6_000);
    return () => globalThis.clearTimeout(timeout);
  }, [catalogFeedback]);
  const toggleGame = (key: string) => setExpandedGameKey((current) => (current === key ? null : key));
  const showOtherDrops = shouldShowOtherDrops(filter, query, groups.length);
  const visibleCampaignCount = groups.reduce((count, group) => count + group.campaigns.length, 0);
  const filterLabel =
    filter === 'hidden-only' ? 'Hidden' : filter === 'favorites-only' ? 'Favorites' : 'Available';

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
              if (!isCatalogSortMode(value)) return;
              setSortMode(value);
              savePreferences(value, filter);
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
              if (!isCatalogFilter(value)) return;
              setFilter(value);
              savePreferences(sortMode, value);
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
            onClick={async () => {
              const result = await onSetGamePreference?.(
                catalogFeedback.game,
                catalogFeedback.undoPreference,
              );
              setCatalogFeedback(null);
              if (result !== false) filterSelectRef.current?.focus();
            }}
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
