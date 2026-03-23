import type { AppState, StreamerSelectionMode, TwitchStreamer } from '../types/index.ts';

const UNKNOWN_VIEWER_COUNT = Number.MAX_SAFE_INTEGER;

export interface StreamerSelectionPreferences {
  mode: StreamerSelectionMode;
  preferredLanguage: string | null;
}

export interface PickStreamerResult {
  streamer: TwitchStreamer | null;
  preferredLanguageApplied: boolean;
  preferredLanguageMatches: number;
  activePoolSize: number;
}

function normalizeLanguageToken(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return null;
  }
  const [primary] = normalized.split('-');
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

export function normalizePreferredStreamerLanguage(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return normalizeLanguageToken(value);
}

function knownViewerCount(streamer: TwitchStreamer): number | null {
  return typeof streamer.viewerCount === 'number' &&
    Number.isFinite(streamer.viewerCount) &&
    streamer.viewerCount >= 0 &&
    streamer.viewerCount < UNKNOWN_VIEWER_COUNT
    ? streamer.viewerCount
    : null;
}

function sortByViewersAscending(streamers: TwitchStreamer[]): TwitchStreamer[] {
  return [...streamers].sort((left, right) => {
    const leftCount = knownViewerCount(left) ?? UNKNOWN_VIEWER_COUNT;
    const rightCount = knownViewerCount(right) ?? UNKNOWN_VIEWER_COUNT;
    if (leftCount !== rightCount) {
      return leftCount - rightCount;
    }
    return left.name.localeCompare(right.name);
  });
}

function sortByViewersDescending(streamers: TwitchStreamer[]): TwitchStreamer[] {
  return [...streamers].sort((left, right) => {
    const leftCount = knownViewerCount(left) ?? -1;
    const rightCount = knownViewerCount(right) ?? -1;
    if (leftCount !== rightCount) {
      return rightCount - leftCount;
    }
    return left.name.localeCompare(right.name);
  });
}

function activePoolForLanguage(
  candidates: TwitchStreamer[],
  preferredLanguage: string | null,
): Omit<PickStreamerResult, 'streamer'> & { pool: TwitchStreamer[] } {
  const normalizedPreferred = normalizePreferredStreamerLanguage(preferredLanguage);
  if (!normalizedPreferred) {
    return {
      pool: candidates,
      preferredLanguageApplied: false,
      preferredLanguageMatches: 0,
      activePoolSize: candidates.length,
    };
  }

  const matches = candidates.filter(
    (streamer) => normalizePreferredStreamerLanguage(streamer.broadcasterLanguage) === normalizedPreferred,
  );
  const pool = matches.length > 0 ? matches : candidates;
  return {
    pool,
    preferredLanguageApplied: matches.length > 0,
    preferredLanguageMatches: matches.length,
    activePoolSize: pool.length,
  };
}

function pickRandom<T>(items: T[], randomFn: () => number): T | null {
  if (items.length === 0) {
    return null;
  }
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(randomFn() * items.length)));
  return items[index] ?? null;
}

function pickStreamerForMode(
  candidates: TwitchStreamer[],
  mode: StreamerSelectionMode,
  randomFn: () => number,
): TwitchStreamer | null {
  if (candidates.length === 0) {
    return null;
  }

  switch (mode) {
    case 'random':
      return pickRandom(candidates, randomFn);

    case 'top-viewers': {
      const known = candidates.filter((streamer) => knownViewerCount(streamer) != null);
      const ordered = known.length > 0 ? sortByViewersDescending(known) : candidates;
      return ordered[0] ?? null;
    }

    default: {
      const known = candidates.filter((streamer) => knownViewerCount(streamer) != null);
      const ordered = sortByViewersAscending(known.length > 0 ? known : candidates);
      const bucketSize =
        ordered.length < 3 ? ordered.length : Math.min(8, Math.max(3, Math.ceil(ordered.length * 0.25)));
      return pickRandom(ordered.slice(0, bucketSize), randomFn);
    }
  }
}

export function pickStreamerForPreferences(
  candidates: TwitchStreamer[],
  preferences: StreamerSelectionPreferences,
  randomFn: () => number = Math.random,
): PickStreamerResult {
  const languagePool = activePoolForLanguage(candidates, preferences.preferredLanguage);
  return {
    preferredLanguageApplied: languagePool.preferredLanguageApplied,
    preferredLanguageMatches: languagePool.preferredLanguageMatches,
    activePoolSize: languagePool.activePoolSize,
    streamer: pickStreamerForMode(languagePool.pool, preferences.mode, randomFn),
  };
}

export function applyStreamerSelectionModeSetting(
  state: AppState,
  mode: StreamerSelectionMode | undefined,
): AppState {
  return {
    ...state,
    streamerSelectionMode: mode === 'random' || mode === 'top-viewers' ? mode : 'low-view',
  };
}

export function applyPreferredStreamerLanguageSetting(
  state: AppState,
  language: string | null | undefined,
): AppState {
  return {
    ...state,
    preferredStreamerLanguage: normalizePreferredStreamerLanguage(language),
  };
}
