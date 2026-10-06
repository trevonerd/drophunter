import { gameKey } from '../shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import {
  discoverEligibleStreamers,
  EligibleStreamerDiscoveryUnavailableError,
} from './eligible-streamer-discovery.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import type { OpenBestStreamerCallbacks, WatchStartResult } from './streamer-acquisition-contracts.ts';
import type { PickStreamerResult, StreamerSelectionPreferences } from './streamer-selection.ts';
import { TwitchDirectoryUnavailableError } from './twitch-api/errors.ts';
import type { WatchHealth } from './watch-transport.ts';

export class WatchPlaybackUnavailableError extends Error {
  readonly name = 'WatchPlaybackUnavailableError';
  constructor(readonly health: WatchHealth | null) {
    super('An eligible Twitch streamer was found, but playback could not start.');
  }
}

export class NoEligibleStreamerError extends Error {
  readonly name = 'NoEligibleStreamerError';

  constructor() {
    super('Twitch verified that this campaign has no eligible alternative streamer.');
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
  const failedStreamers =
    state.appState.queueEntryMetadataByKey[gameKey(selectedGame)]?.stalledStreamerNames ?? [];
  const discovery = await discoverEligibleStreamers({
    game: { ...selectedGame, allowedChannels: allowed },
    language: state.appState.preferredStreamerLanguage ?? '',
    excludedStreamerNames: failedStreamers,
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
  const candidates = discovery.kind === 'ready' ? [...discovery.streamers] : [];
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
    verifiedCount: candidates.length,
  });
  if (candidates.length === 0 && allowed?.length) {
    logWarn('No allowed streamers are live for selected game', {
      game: deps.getGameDisplayLabel(gameForSelection),
      allowedChannels: allowed.length,
      totalStreamers: 0,
    });
  }
  if (candidates.length === 0) {
    logWarn('No streamer found for selected game', {
      game: deps.getGameDisplayLabel(gameForSelection),
      categorySlug: gameForSelection.categorySlug ?? null,
    });
    if (
      discovery.kind === 'empty' &&
      failedStreamers.length > 0 &&
      state.appState.recoveryReason === 'stalled-progress'
    ) {
      throw new NoEligibleStreamerError();
    }
    return false;
  }
  let remaining = candidates;
  const avoidName = state.avoidStreamerName?.trim().toLowerCase();
  if (avoidName) {
    const withoutAvoided = candidates.filter(
      (candidate) => candidate.name.trim().toLowerCase() !== avoidName,
    );
    if (withoutAvoided.length > 0) remaining = withoutAvoided;
  }
  let lastFailure: WatchHealth | null = null;
  for (let attempt = 0; attempt < Math.min(3, candidates.length); attempt += 1) {
    if (!isCurrent()) return false;
    const selection = deps.pickStreamerForPreferences(
      remaining,
      preferences,
      Math.random,
      languageFilterApplied,
    );
    const streamer = selection.streamer;
    if (!streamer) break;
    remaining = remaining.filter((candidate) => candidate.name.toLowerCase() !== streamer.name.toLowerCase());
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
    if (callbacks.onOpenWatchTransport) {
      let result: WatchStartResult;
      try {
        state.streamerAcquisitionPhase = 'playback';
        result = watchStartResult(await callbacks.onOpenWatchTransport(streamer));
      } catch (error) {
        if (!isCurrent()) return false;
        logWarn('Watch transport failed after streamer selection', { error: String(error) });
        result = { kind: 'failed', health: null };
      }
      if (!isCurrent() || result.kind === 'cancelled') return false;
      if (result.kind === 'failed') {
        lastFailure = result.health;
        continue;
      }
    } else {
      state.streamerAcquisitionPhase = 'playback';
      await callbacks.onOpenForegroundChannel(streamer);
      if (!isCurrent()) return false;
    }
    const previousName = state.appState.activeStreamer?.name.trim().toLowerCase();
    state.avoidStreamerName = null;
    state.appState.activeStreamer = streamer;
    if (previousName !== streamer.name.trim().toLowerCase()) {
      state.lastProgressAdvanceAt = Date.now();
      if (state.appState.recoveryReason === 'stalled-progress') {
        state.recoveryBackoffUntil =
          state.lastProgressAdvanceAt +
          computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);
        state.appState.recoveryBackoffUntil = state.recoveryBackoffUntil;
      }
    }
    return true;
  }
  throw new WatchPlaybackUnavailableError(lastFailure);
}
