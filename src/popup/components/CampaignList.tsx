import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { dropMatchesGame, isFavoriteGame } from '../../shared/game-selection';
import type { CampaignPriorityMode, TwitchDrop, TwitchGame } from '../../types';
import {
  type CampaignCatalogFilter,
  type CampaignCatalogSortMode,
  type CampaignProgressLookup,
  groupCampaigns,
  sortCampaignGroups,
} from './campaign-list-model';
import { GameCampaignGroup } from './GameCampaignGroup';
import { OtherDropsDisclosure } from './OtherDropsDisclosure';

export type {
  CampaignProgressLookup,
  CampaignProgressSummary,
} from './campaign-list-model';

export interface CampaignListProps {
  readonly campaigns: readonly TwitchGame[];
  readonly drops?: readonly TwitchDrop[];
  readonly favoriteGameIds?: ReadonlySet<string> | readonly string[];
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
  return value === 'all' || value === 'favorites-only';
}

function favoriteIdSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> {
  return value instanceof Set ? value : new Set(value ?? []);
}

export function shouldShowOtherDrops(
  filter: CampaignCatalogFilter,
  query: string,
  resultCount: number,
): boolean {
  return filter === 'all' && query.trim() === '' && resultCount > 0;
}

export function CampaignList({
  campaigns,
  drops = [],
  favoriteGameIds,
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
  onAddToQueue,
  onAddAllToQueue,
  onRemoveFromQueue,
  onLinkAccount,
}: CampaignListProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<CampaignCatalogSortMode>(() => initialSortMode(priorityMode));
  const [filter, setFilter] = useState<CampaignCatalogFilter>('all');
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
        if (isCatalogFilter(record.filter)) setFilter(record.filter);
      })
      .catch(() => undefined);
  }, []);

  const favorites = useMemo(() => favoriteIdSet(favoriteGameIds), [favoriteGameIds]);
  const loadedKeys = favoriteIdSet(loadedCampaignKeys);
  const groups = useMemo(() => {
    const grouped = groupCampaigns(campaigns, drops, query).filter((group) => {
      if (filter === 'all') return true;
      const representative = group.campaigns[0];
      return representative ? isFavoriteGame(representative, favorites) : false;
    });
    return sortCampaignGroups(grouped, sortMode, progressByCampaignKey);
  }, [campaigns, drops, favorites, filter, progressByCampaignKey, query, sortMode]);
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
  const toggleGame = (key: string) => setExpandedGameKey((current) => (current === key ? null : key));
  const showOtherDrops = shouldShowOtherDrops(filter, query, groups.length);

  return (
    <section aria-label="Campaigns" className="dh-group min-w-0">
      <div className="dh-campaign-browser-heading flex items-center justify-between gap-2">
        <h2 className="dh-title text-xs">Games and campaigns</h2>
        <span className="text-right text-[10px] text-[color:var(--dh-muted)]">
          {groups.length} games · {campaigns.length} campaigns
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
        <label
          className="dh-catalog-tool dh-focus"
          title={filter === 'all' ? 'Show all games' : 'Favorites only'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill={filter === 'favorites-only' ? 'currentColor' : 'none'}
            aria-hidden="true"
          >
            <path
              d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.53l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          <select
            aria-label="Filter games"
            value={filter}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (!isCatalogFilter(value)) return;
              setFilter(value);
              savePreferences(sortMode, value);
            }}
          >
            <option value="all">All games</option>
            <option value="favorites-only">Favorite games only</option>
          </select>
        </label>
      </div>
      {groups.length === 0 ? (
        <p className="dh-panel px-3 py-2.5 text-[11px] text-[color:var(--dh-muted)]" role="status">
          {campaigns.length === 0 ? 'No campaigns available.' : 'No campaigns match your search.'}
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
                  queueGames={queueGames}
                  loadedCampaignKeys={loadedKeys}
                  expanded={expandedGameKey === group.key}
                  progressByCampaignKey={progressByCampaignKey}
                  highlightedCampaignKey={activeHighlightKey}
                  actionLoading={actionLoading}
                  now={now}
                  runningGame={runningGame}
                  onToggleGame={toggleGame}
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
