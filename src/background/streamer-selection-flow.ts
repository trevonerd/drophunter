import { gameKey } from '../shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import {
  discoverEligibleStreamers,
  EligibleStreamerDiscoveryUnavailableError,
  NoEligibleStreamerError,
} from './eligible-streamer-discovery.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { OFFLINE_CONFIRMATION_CHECKS } from './stream-rotation.ts';
import type { OpenBestStreamerCallbacks, WatchStartResult } from './streamer-acquisition-contracts.ts';
import type { PickStreamerResult, StreamerSelectionPreferences } from './streamer-selection.ts';
import {
  beginStreamerWatchAttempt,
  MAX_STREAMER_ATTEMPTS,
  streamerCandidatesForWatchAttempt,
} from './streamer-watch-attempt.ts';
import { TwitchDirectoryUnavailableError } from './twitch-api/errors.ts';
import { isWatchPreparationUnavailable } from './watch-health.ts';
import type { WatchHealth } from './watch-transport.ts';

export { NoEligibleStreamerError } from './eligible-streamer-discovery.ts';

export class WatchPlaybackUnavailableError extends Error {
  readonly name = 'WatchPlaybackUnavailableError';
  constructor(
    readonly health: WatchHealth | null,
    readonly streamerName?: string,
    readonly alternativesExhausted = false,
  ) {
    super('An eligible Twitch streamer was found, but playback could not start.');
  }
}

function watchStartResult(value: WatchStartResult | boolean): WatchStartResult {
  return typeof value === 'boolean'
    ? value
      ? { kind: 'started', health: null }
      : { kind: 'failed', health: null }
    : value;
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
    const channels =
      state.cachedCampaignChannelsMap[campaignId] !== undefined
        ? state.cachedCampaignChannelsMap[campaignId]
        : campaignId === selectedGame.campaignId
          ? selectedGame.allowedChannels
          : undefined;
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
  const isCurrent = callbacks.isCurrent ?? (() => true);
  if (!isCurrent()) return false;
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
  if (!isCurrent()) return false;
  const { allowed, pendingCampaignIds } = resolveAllowedChannels(
    state,
    selectedGame,
    dropsForGame,
    deps.isRewardAcquired,
  );
  const metadata = state.appState.queueEntryMetadataByKey[gameKey(selectedGame)];
  const failedStreamers = (metadata?.attemptedStreamerNames ?? []).filter(
    (name) =>
      (!metadata?.watchAttempt?.preparing && metadata?.watchAttempt?.suspendedAt === undefined) ||
      metadata?.watchAttempt?.channelName !== name,
  );
  if (failedStreamers.length >= MAX_STREAMER_ATTEMPTS)
    throw new WatchPlaybackUnavailableError(null, undefined, true);
  const discovery = await discoverEligibleStreamers({
    game: { ...selectedGame, allowedChannels: allowed },
    language: state.appState.preferredStreamerLanguage ?? '',
    excludedStreamerNames: [
      ...failedStreamers,
      ...(state.offlineChecks >= OFFLINE_CONFIRMATION_CHECKS && state.avoidStreamerName
        ? [state.avoidStreamerName]
        : []),
    ],
    isCurrent,
    fetchDirectory: async (game, language) => {
      const directory = await callbacks.onFetchDirectoryStreamersFromApi(game, false, language, isCurrent);
      return { streamers: directory, languageFilterApplied: directory.languageFilterApplied };
    },
    probeChannel: callbacks.probeStreamInfo ?? (async () => ({ kind: 'unavailable' as const })),
    ...(callbacks.onRefreshVerifiedGame
      ? {
          refresh: async () => {
            const game = await callbacks.onRefreshVerifiedGame?.(selectedGame, isCurrent);
            return game ? { kind: 'ready' as const, game } : { kind: 'unavailable' as const };
          },
        }
      : {}),
  });
  if (!isCurrent() || discovery.kind === 'cancelled') return false;
  if (discovery.kind === 'unavailable') {
    if (discovery.cause !== undefined) {
      throw discovery.cause instanceof TwitchDirectoryUnavailableError
        ? discovery.cause
        : new TwitchDirectoryUnavailableError(discovery.cause);
    }
    throw new EligibleStreamerDiscoveryUnavailableError();
  }
  const gameForSelection = discovery.game;
  const candidates =
    discovery.kind === 'ready' ? streamerCandidatesForWatchAttempt(discovery.streamers, metadata) : [];
  const languageFilterApplied = discovery.kind === 'ready' && discovery.languageFilterApplied;
  let preferences: StreamerSelectionPreferences = {
    mode: state.appState.streamerSelectionMode,
    preferredLanguage: state.appState.preferredStreamerLanguage,
  };
  if (discovery.kind === 'ready' && discovery.preferredLanguageFallbackApplied) {
    preferences = { mode: 'random', preferredLanguage: null };
  }
  logDebug('Streamer selection debug', {
    game: deps.getGameDisplayLabel(gameForSelection),
    pendingCampaignIds: Array.from(pendingCampaignIds),
    allowedChannels: allowed ?? 'null (any channel)',
    verifiedStreamers: candidates.map((s) => s.name),
  });
  if (candidates.length === 0 && allowed?.length) {
    logInfo('No allowed streamers are live for selected game', {
      game: deps.getGameDisplayLabel(gameForSelection),
      allowedChannels: allowed.length,
      totalStreamers: 0,
    });
  }
  if (candidates.length === 0) {
    logInfo('No streamer found for selected game', {
      game: deps.getGameDisplayLabel(gameForSelection),
      categorySlug: gameForSelection.categorySlug ?? null,
    });
    throw new NoEligibleStreamerError();
  }
  let remaining = candidates;
  const pending = metadata?.watchAttempt?.preparing ? metadata.watchAttempt.channelName : null;
  const avoidName = state.avoidStreamerName?.trim().toLowerCase();
  if (avoidName && !pending) {
    const withoutAvoided = candidates.filter(
      (candidate) => candidate.name.trim().toLowerCase() !== avoidName,
    );
    if (withoutAvoided.length > 0) remaining = withoutAvoided;
  }
  {
    if (!isCurrent()) return false;
    const selection = deps.pickStreamerForPreferences(
      remaining,
      preferences,
      Math.random,
      languageFilterApplied,
    );
    const streamer = selection.streamer;
    if (!streamer) return false;
    const reserved = callbacks.onAttemptStreamer
      ? await callbacks.onAttemptStreamer(selectedGame, streamer.name)
      : beginStreamerWatchAttempt(state, selectedGame, streamer.name);
    if (!reserved || !isCurrent()) return false;
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
    state.streamerAcquisitionPhase = 'playback';
    if (callbacks.onOpenWatchTransport) {
      let result: WatchStartResult;
      try {
        result = watchStartResult(await callbacks.onOpenWatchTransport(streamer));
      } catch (error) {
        if (!isCurrent()) return false;
        logWarn('Watch transport failed after streamer selection', { error: String(error) });
        result = { kind: 'failed', health: null };
      }
      if (!isCurrent() || result.kind === 'cancelled') return false;
      if (result.kind === 'failed') {
        if (isWatchPreparationUnavailable(result.health))
          throw new EligibleStreamerDiscoveryUnavailableError();
        throw new WatchPlaybackUnavailableError(
          result.health,
          streamer.name,
          discovery.kind === 'ready' &&
            discovery.streamers.every(
              (candidate) => candidate.name.trim().toLowerCase() === streamer.name.trim().toLowerCase(),
            ),
        );
      }
    } else {
      await callbacks.onOpenForegroundChannel(streamer);
      if (!isCurrent()) return false;
    }
    state.avoidStreamerName = null;
    state.appState.activeStreamer = streamer;
    return true;
  }
}
