import { useEffect, useMemo, useRef, useState } from 'react';
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

export function resolveStoredCatalogFilter(
  value: unknown,
  hiddenGameIds: ReadonlySet<string> | readonly string[] | undefined,
): CampaignCatalogFilter {
  const storedFilter = value === 'all' ? 'available' : isCatalogFilter(value) ? value : 'available';
  return storedFilter === 'hidden-only' && favoriteIdSet(hiddenGameIds).size === 0
    ? 'available'
    : storedFilter;
}

export function shouldShowOtherDrops(
  filter: CampaignCatalogFilter,
  query: string,
  resultCount: number,
): boolean {
  return (filter === 'available' || filter === 'all') && query.trim() === '' && resultCount > 0;
}

export interface UseCampaignListStateArgs {
  readonly campaigns: readonly TwitchGame[];
  readonly drops: readonly TwitchDrop[];
  readonly favoriteGameIds?: ReadonlySet<string> | readonly string[];
  readonly hiddenGameIds?: ReadonlySet<string> | readonly string[];
  readonly progressByCampaignKey?: CampaignProgressLookup;
  readonly priorityMode?: CampaignPriorityMode;
  readonly highlightedCampaignKey?: string | null;
  readonly onSetFavorite?: (game: TwitchGame, favorite: boolean) => void;
  readonly onSetGamePreference?: (
    game: TwitchGame,
    preference: GamePreference,
  ) => Promise<boolean> | undefined;
}

export function useCampaignListState({
  campaigns,
  drops,
  favoriteGameIds,
  hiddenGameIds,
  progressByCampaignKey,
  priorityMode,
  highlightedCampaignKey = null,
  onSetFavorite,
  onSetGamePreference,
}: UseCampaignListStateArgs) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<CampaignCatalogSortMode>(() => initialSortMode(priorityMode));
  const [filter, setFilter] = useState<CampaignCatalogFilter>('available');
  const initialHiddenGameIds = useRef(hiddenGameIds);
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
        const restoredFilter = resolveStoredCatalogFilter(record.filter, initialHiddenGameIds.current);
        setFilter(restoredFilter);
        if (record.filter !== restoredFilter) {
          return browser.storage.local.set({
            [CATALOG_PREFERENCES_KEY]: { ...record, filter: restoredFilter },
          });
        }
      })
      .catch(() => undefined);
  }, []);

  const favorites = useMemo(() => favoriteIdSet(favoriteGameIds), [favoriteGameIds]);
  const hidden = useMemo(() => favoriteIdSet(hiddenGameIds), [hiddenGameIds]);
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
  const filterLabel =
    filter === 'hidden-only' ? 'Hidden' : filter === 'favorites-only' ? 'Favorites' : 'Available';
  const savePreferences = (nextSort: CampaignCatalogSortMode, nextFilter: CampaignCatalogFilter) => {
    void browser.storage.local
      .set({ [CATALOG_PREFERENCES_KEY]: { sortMode: nextSort, filter: nextFilter } })
      .catch(() => undefined);
  };
  const updateSortMode = (value: CampaignCatalogSortMode) => {
    setSortMode(value);
    savePreferences(value, filter);
  };
  const updateFilter = (value: CampaignCatalogFilter) => {
    setFilter(value);
    savePreferences(sortMode, value);
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
  const undoPreference = async () => {
    if (!catalogFeedback) return;
    await onSetGamePreference?.(catalogFeedback.game, catalogFeedback.undoPreference);
    setCatalogFeedback(null);
    filterSelectRef.current?.focus();
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

  return {
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
  };
}
