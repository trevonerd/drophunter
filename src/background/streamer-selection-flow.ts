import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { logDebug, logInfo, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { OpenBestStreamerCallbacks } from './streamer-acquisition-contracts.ts';
import type { PickStreamerResult, StreamerSelectionPreferences } from './streamer-selection.ts';

function filterStreamersByAllowedChannels(
  streamers: TwitchStreamer[],
  allowed: string[] | null,
): TwitchStreamer[] {
  if (allowed == null || allowed.length === 0) return streamers;
  const allowedSet = new Set(allowed.map((channel) => channel.toLowerCase()));
  return streamers.filter((streamer) => allowedSet.has(streamer.name.toLowerCase()));
}

interface OpenBestStreamerDependencies {
  dropMatchesSelectedGame: (drop: TwitchDrop, selected: TwitchGame) => boolean;
  isRewardAcquired: (drop: TwitchDrop) => boolean;
  getGameDisplayLabel: (game: TwitchGame) => string;
  resolveCategorySlug: (game: TwitchGame) => Promise<string>;
  pickStreamerForPreferences: (
    candidates: TwitchStreamer[],
    prefs: StreamerSelectionPreferences,
    randomFn: () => number,
    filterApplied: boolean,
  ) => PickStreamerResult;
  normalizePreferredStreamerLanguage: (lang?: string | null) => string | null | undefined;
}

function resolveAllowedChannels(
  state: ServiceWorkerState,
  selectedGame: TwitchGame,
  dropsForGame: TwitchDrop[],
  isRewardAcquired: (drop: TwitchDrop) => boolean,
) {
  const pendingCampaignIds = new Set(
    dropsForGame
      .filter((drop) => !isRewardAcquired(drop))
      .map((drop) => drop.campaignId)
      .filter((id): id is string => Boolean(id)),
  );
  let allowed: string[] | null = null;
  let unrestricted = false;
  const restricted: string[] = [];
  for (const campaignId of pendingCampaignIds) {
    const channels = state.cachedCampaignChannelsMap[campaignId];
    if (channels == null) unrestricted = true;
    else restricted.push(...channels);
  }
  if (!unrestricted && restricted.length > 0) allowed = [...new Set(restricted)];
  if (pendingCampaignIds.size === 0) allowed = selectedGame.allowedChannels ?? null;
  return { allowed, pendingCampaignIds };
}

export async function openBestStreamerForSelectedGame(
  state: ServiceWorkerState,
  callbacks: OpenBestStreamerCallbacks,
  deps: OpenBestStreamerDependencies,
): Promise<boolean> {
  const initialSelection = state.appState.selectedGame;
  if (!initialSelection) {
    logWarn('Unable to open streamer: no selected game');
    return false;
  }
  const dropsForGame = state.cachedDropsSnapshot.filter((drop) =>
    deps.dropMatchesSelectedGame(drop, initialSelection),
  );
  if (dropsForGame.length > 0 && dropsForGame.every(deps.isRewardAcquired)) {
    logInfo('Skipping streamer: all drops completed', { game: deps.getGameDisplayLabel(initialSelection) });
    return false;
  }

  const selectedGame = {
    ...initialSelection,
    categorySlug: await deps.resolveCategorySlug(initialSelection),
  };
  state.appState.selectedGame = selectedGame;
  const streamers = await callbacks.onFetchDirectoryStreamersFromApi(
    selectedGame,
    false,
    state.appState.preferredStreamerLanguage ?? '',
  );
  logDebug('Language filter applied to directory query', {
    language: state.appState.preferredStreamerLanguage ?? '',
    resultCount: streamers.length,
    filterApplied: streamers.languageFilterApplied,
  });
  if (!streamers.languageFilterApplied && state.appState.preferredStreamerLanguage) {
    logDebug('Language filter fallback: server-side filter returned 0 results, using unfiltered', {
      language: state.appState.preferredStreamerLanguage,
    });
  }

  const { allowed, pendingCampaignIds } = resolveAllowedChannels(
    state,
    selectedGame,
    dropsForGame,
    deps.isRewardAcquired,
  );
  logDebug('Streamer selection debug', {
    game: deps.getGameDisplayLabel(selectedGame),
    pendingCampaignIds: Array.from(pendingCampaignIds),
    allowedChannels: allowed ?? 'null (any channel)',
    directoryStreamers: streamers.map((s) => s.name),
    directoryCount: streamers.length,
  });
  let candidates = filterStreamersByAllowedChannels(streamers, allowed);
  let languageFilterApplied = streamers.languageFilterApplied;
  let preferences: StreamerSelectionPreferences = {
    mode: state.appState.streamerSelectionMode,
    preferredLanguage: state.appState.preferredStreamerLanguage,
  };
  let totalStreamers = streamers.length;
  if (allowed != null && allowed.length > 0) {
    const allowedSet = new Set(allowed.map((channel) => channel.toLowerCase()));
    logDebug('Filtered streamers by allowedChannels', {
      game: deps.getGameDisplayLabel(selectedGame),
      beforeFilter: streamers.length,
      afterFilter: candidates.length,
      candidateNames: candidates.map((s) => s.name),
      rejected: streamers.filter((s) => !allowedSet.has(s.name.toLowerCase())).map((s) => s.name),
    });
  }
  if (candidates.length === 0 && allowed?.length && streamers.languageFilterApplied) {
    const unfiltered = await callbacks.onFetchDirectoryStreamersFromApi(selectedGame, false, '');
    candidates = filterStreamersByAllowedChannels(unfiltered, allowed);
    languageFilterApplied = unfiltered.languageFilterApplied;
    totalStreamers = unfiltered.length;
    logDebug('Retrying streamer selection without preferred language', {
      game: deps.getGameDisplayLabel(selectedGame),
      preferredLanguage: state.appState.preferredStreamerLanguage,
      beforeFilter: unfiltered.length,
      afterFilter: candidates.length,
      candidateNames: candidates.map((s) => s.name),
    });
    if (candidates.length > 0) preferences = { mode: 'random', preferredLanguage: null };
  }
  if (candidates.length === 0 && allowed?.length && streamers.length > 0) {
    logWarn('No allowed streamers are live for selected game', {
      game: deps.getGameDisplayLabel(selectedGame),
      allowedChannels: allowed.length,
      totalStreamers,
    });
  }
  const avoidName = state.avoidStreamerName;
  if (avoidName) {
    const withoutAvoided = candidates.filter(
      (candidate) => candidate.name.toLowerCase() !== avoidName.toLowerCase(),
    );
    if (withoutAvoided.length > 0 && withoutAvoided.length < candidates.length) candidates = withoutAvoided;
  }
  const selection = deps.pickStreamerForPreferences(
    candidates,
    preferences,
    Math.random,
    languageFilterApplied,
  );
  const streamer = selection.streamer;
  if (!streamer) {
    logWarn('No streamer found for selected game', {
      game: deps.getGameDisplayLabel(selectedGame),
      categorySlug: selectedGame.categorySlug ?? null,
    });
    state.appState.activeStreamer = null;
    return false;
  }
  logInfo('Opening selected streamer', {
    game: deps.getGameDisplayLabel(selectedGame),
    selectionMode: preferences.mode,
    preferredLanguage: deps.normalizePreferredStreamerLanguage(preferences.preferredLanguage),
    preferredLanguageApplied: selection.preferredLanguageApplied,
    preferredLanguageMatches: selection.preferredLanguageMatches,
    activePoolSize: selection.activePoolSize,
    serverLanguageFilterApplied: languageFilterApplied,
    streamer: streamer.name,
    viewers: streamer.viewerCount ?? null,
    broadcasterLanguage: streamer.broadcasterLanguage ?? null,
    candidates: candidates.length,
  });
  state.avoidStreamerName = null;
  if (callbacks.onOpenWatchTransport) {
    const opened = await callbacks.onOpenWatchTransport(streamer);
    if (opened) state.appState.activeStreamer = streamer;
    return opened;
  }
  await callbacks.onOpenForegroundChannel(streamer);
  return true;
}
