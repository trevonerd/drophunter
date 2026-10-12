import { isExpectedStreamCategory } from '../shared/stream-category.ts';
import type { TwitchGame, TwitchStreamer } from '../types/index.ts';

export type StreamInfoProbe =
  | { readonly kind: 'offline' }
  | { readonly kind: 'unavailable'; readonly cause?: unknown }
  | {
      readonly kind: 'live';
      readonly streamer: TwitchStreamer;
      readonly categoryId?: string;
      readonly categoryLabel?: string;
    };

interface EligibleStreamerDirectory {
  readonly streamers: readonly TwitchStreamer[];
  readonly languageFilterApplied: boolean;
}

export type EligibleStreamerDiscoveryResult =
  | {
      readonly kind: 'ready';
      readonly game: TwitchGame;
      readonly streamers: readonly TwitchStreamer[];
      readonly languageFilterApplied: boolean;
      readonly preferredLanguageFallbackApplied: boolean;
    }
  | { readonly kind: 'empty'; readonly game: TwitchGame }
  | { readonly kind: 'unavailable'; readonly cause?: unknown }
  | { readonly kind: 'cancelled' };

export class EligibleStreamerDiscoveryUnavailableError extends Error {
  readonly name = 'EligibleStreamerDiscoveryUnavailableError';

  constructor() {
    super('Twitch could not verify eligible live streamers for this campaign.');
  }
}

export class NoEligibleStreamerError extends Error {
  readonly name = 'NoEligibleStreamerError';

  constructor() {
    super('Twitch verified that this campaign has no eligible alternative streamer.');
  }
}

export interface EligibleStreamerDiscoveryOptions {
  readonly game: TwitchGame;
  readonly language: string;
  readonly excludedStreamerNames?: readonly string[];
  readonly isCurrent?: () => boolean;
  readonly fetchDirectory: (game: TwitchGame, language: string) => Promise<EligibleStreamerDirectory>;
  readonly probeChannel: (channel: string) => Promise<StreamInfoProbe>;
  /** Must return a campaign verified from a fresh complete campaigns + inventory snapshot. */
  readonly refresh?: () => Promise<
    | { readonly kind: 'ready'; readonly game: TwitchGame }
    | { readonly kind: 'unavailable'; readonly cause?: unknown }
  >;
}

function allowedChannels(
  game: TwitchGame,
):
  | { readonly kind: 'unrestricted' }
  | { readonly kind: 'restricted'; readonly names: string[] }
  | { readonly kind: 'malformed' } {
  if (!game.allowedChannels?.length) return { kind: 'unrestricted' };
  const names = [
    ...new Set(game.allowedChannels.map((channel) => channel.trim().toLowerCase()).filter(Boolean)),
  ];
  return names.length > 0 ? { kind: 'restricted', names } : { kind: 'malformed' };
}

function sameCategory(
  probe: Extract<StreamInfoProbe, { readonly kind: 'live' }>,
  game: TwitchGame,
): boolean | null {
  if (probe.categoryId && game.categoryId) return probe.categoryId === game.categoryId;
  if (!probe.categoryLabel) return null;
  return isExpectedStreamCategory(
    { categoryLabel: probe.categoryLabel },
    { categorySlug: game.categorySlug, categoryName: game.name },
  );
}

async function query(
  game: TwitchGame,
  language: string,
  isCurrent: () => boolean,
  fetchDirectory: EligibleStreamerDiscoveryOptions['fetchDirectory'],
  probeChannel: EligibleStreamerDiscoveryOptions['probeChannel'],
  excludedStreamerNames: readonly string[],
): Promise<
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable'; readonly cause?: unknown }
  | {
      readonly kind: 'complete';
      readonly streamers: readonly TwitchStreamer[];
      readonly languageFilterApplied: boolean;
      readonly preferredLanguageFallbackApplied: boolean;
      readonly verificationIncomplete: boolean;
      readonly verificationCause?: unknown;
    }
> {
  const allowedSet = allowedChannels(game);
  if (allowedSet.kind === 'malformed') return { kind: 'unavailable' };
  const allowed = allowedSet.kind === 'restricted' ? allowedSet.names : null;
  const excluded = new Set(excludedStreamerNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  let directory: EligibleStreamerDirectory;
  try {
    directory = await fetchDirectory(game, language);
  } catch (cause) {
    return { kind: 'unavailable', cause };
  }
  if (!isCurrent()) return { kind: 'cancelled' };

  const directoryNames = new Set(directory.streamers.map((streamer) => streamer.name.trim().toLowerCase()));
  const inScope = (streamers: readonly TwitchStreamer[]) =>
    streamers.filter((streamer) => {
      const name = streamer.name.trim().toLowerCase();
      return streamer.isLive && !excluded.has(name) && (allowed === null || allowed.includes(name));
    });
  let streamers = inScope(directory.streamers);
  let languageFilterApplied = directory.languageFilterApplied;
  let triedPreferredLanguageFallback = false;
  if (streamers.length === 0 && directory.languageFilterApplied && language) {
    triedPreferredLanguageFallback = true;
    try {
      directory = await fetchDirectory(game, '');
    } catch (cause) {
      return { kind: 'unavailable', cause };
    }
    if (!isCurrent()) return { kind: 'cancelled' };
    for (const streamer of directory.streamers) directoryNames.add(streamer.name.trim().toLowerCase());
    streamers = inScope(directory.streamers);
    languageFilterApplied = directory.languageFilterApplied;
  }

  let incomplete = false;
  let verificationCause: unknown;
  if (allowed) {
    const found = new Set(streamers.map((streamer) => streamer.name.trim().toLowerCase()));
    const missing = allowed.filter(
      (channel) => !excluded.has(channel) && !directoryNames.has(channel) && !found.has(channel),
    );
    if (!isCurrent()) return { kind: 'cancelled' };
    const probed = await Promise.all(
      missing.map(async (channel) => {
        try {
          return await probeChannel(channel);
        } catch (cause) {
          return { kind: 'unavailable', cause } as const;
        }
      }),
    );
    if (!isCurrent()) return { kind: 'cancelled' };
    for (const result of probed) {
      if (result.kind === 'unavailable') {
        incomplete = true;
        verificationCause ??= result.cause;
      } else if (result.kind === 'live') {
        const category = sameCategory(result, game);
        if (category === null) incomplete = true;
        else if (category) streamers = [...streamers, result.streamer];
      }
    }
  }
  return {
    kind: 'complete',
    streamers,
    languageFilterApplied,
    preferredLanguageFallbackApplied: triedPreferredLanguageFallback && streamers.length > 0,
    verificationIncomplete: incomplete,
    ...(verificationCause === undefined ? {} : { verificationCause }),
  };
}

export async function discoverEligibleStreamers(
  options: EligibleStreamerDiscoveryOptions,
): Promise<EligibleStreamerDiscoveryResult> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!isCurrent()) return { kind: 'cancelled' };
  let game = options.game;
  let result = await query(
    game,
    options.language,
    isCurrent,
    options.fetchDirectory,
    options.probeChannel,
    options.excludedStreamerNames ?? [],
  );
  if (result.kind === 'cancelled' || result.kind === 'unavailable') return result;
  if (result.streamers.length > 0) {
    return {
      kind: 'ready',
      game,
      streamers: result.streamers,
      languageFilterApplied: result.languageFilterApplied,
      preferredLanguageFallbackApplied: result.preferredLanguageFallbackApplied,
    };
  }

  if (options.refresh) {
    let refreshed: Awaited<ReturnType<NonNullable<typeof options.refresh>>>;
    try {
      refreshed = await options.refresh();
    } catch (cause) {
      return { kind: 'unavailable', cause: result.verificationCause ?? cause };
    }
    if (!isCurrent()) return { kind: 'cancelled' };
    if (refreshed.kind !== 'ready') {
      return {
        kind: 'unavailable',
        ...(result.verificationCause === undefined
          ? refreshed.cause === undefined
            ? {}
            : { cause: refreshed.cause }
          : { cause: result.verificationCause }),
      };
    }
    game = refreshed.game;
    result = await query(
      game,
      options.language,
      isCurrent,
      options.fetchDirectory,
      options.probeChannel,
      options.excludedStreamerNames ?? [],
    );
    if (result.kind === 'cancelled' || result.kind === 'unavailable') return result;
  }
  if (!isCurrent()) return { kind: 'cancelled' };
  if (result.verificationIncomplete) {
    return {
      kind: 'unavailable',
      ...(result.verificationCause === undefined ? {} : { cause: result.verificationCause }),
    };
  }
  return result.streamers.length > 0
    ? {
        kind: 'ready',
        game,
        streamers: result.streamers,
        languageFilterApplied: result.languageFilterApplied,
        preferredLanguageFallbackApplied: result.preferredLanguageFallbackApplied,
      }
    : { kind: 'empty', game };
}
