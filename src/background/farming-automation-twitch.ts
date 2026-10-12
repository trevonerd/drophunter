import { gameKey } from '../shared/game-selection.ts';
import { toSlug } from '../shared/utils.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types/index.ts';
import type { StreamInfoProbe } from './eligible-streamer-discovery.ts';
import {
  type FarmingAutomationNormalizedDrop,
  type FarmingAutomationNormalizedGame,
  type FarmingAutomationTwitchSnapshot,
  normalizeFarmingAutomationSnapshot,
} from './farming-automation-normalization.ts';
import type { TwitchSession } from './twitch-api/types.ts';

export type {
  FarmingAutomationNormalizedDrop,
  FarmingAutomationNormalizedGame,
  FarmingAutomationTwitchSnapshot,
} from './farming-automation-normalization.ts';
export { normalizeFarmingAutomationSnapshot } from './farming-automation-normalization.ts';
export interface FarmingAutomationRefreshPatch {
  readonly availableGames: readonly FarmingAutomationNormalizedGame[];
  readonly allDrops: readonly FarmingAutomationNormalizedDrop[];
  readonly campaignDropsByKey: Readonly<Record<string, readonly FarmingAutomationNormalizedDrop[]>>;
  readonly campaignChannelsMap: Readonly<Record<string, readonly string[] | null>>;
}
interface FarmingAutomationRefreshOptions {
  /** Queued Play requires a new, fully verified campaigns + inventory snapshot. */
  readonly requireFreshCompleteSnapshot?: boolean;
  /** Restricts an additional zero-candidate refresh to passive session use. */
  readonly allowSessionRecovery?: boolean;
  readonly onSessionResolved?: (userId: string) => void;
}
type FarmingAutomationRefreshResult =
  | {
      readonly kind: 'ready';
      readonly snapshot: FarmingAutomationTwitchSnapshot;
      readonly refreshPatch: FarmingAutomationRefreshPatch;
      readonly sessionUserId?: string;
    }
  | { readonly kind: 'session-missing' };
export interface FarmingAutomationDirectoryResponse {
  readonly streamers: readonly TwitchStreamer[];
  readonly languageFilterApplied: boolean;
}
interface FarmingAutomationDirectoryRequestOptions {
  readonly sessionRecoveryMode?: 'passive' | 'background-tab';
  readonly preserveSessionOnAuthFailure?: boolean;
}
interface FarmingAutomationDirectoryTarget {
  readonly campaignKey: string;
  readonly campaignId: string | null;
  readonly gameId: string;
  readonly gameName: string;
  readonly categoryId: string | null;
  readonly categorySlug: string;
}
type FarmingAutomationDirectoryResult =
  | {
      readonly kind: 'ready';
      readonly target: FarmingAutomationDirectoryTarget;
      readonly streamers: readonly Readonly<TwitchStreamer>[];
      readonly languageFilterApplied: boolean;
    }
  | { readonly kind: 'session-missing' };
export interface FarmingAutomationTwitchSource {
  readonly loadSession: (forceRefresh: boolean) => Promise<TwitchSession | null>;
  readonly assertCanRefresh?: (options: FarmingAutomationRefreshOptions) => void;
  readonly fetchCampaignSnapshot: (
    session: TwitchSession | null,
    options?: FarmingAutomationRefreshOptions,
  ) => Promise<DropsSnapshot | null>;
  /** Whether a specific campaign snapshot already includes a fresh inventory projection. */
  readonly campaignSnapshotIncludesInventory?: (snapshot: DropsSnapshot) => boolean;
  readonly fetchInventorySnapshot?: (
    session: TwitchSession,
    baseDrops: readonly TwitchDrop[],
  ) => Promise<DropsSnapshot | null>;
  readonly fetchDirectoryStreamers: (
    game: TwitchGame,
    session: TwitchSession,
    language: string,
    options?: FarmingAutomationDirectoryRequestOptions,
  ) => Promise<FarmingAutomationDirectoryResponse>;
  readonly probeStreamInfo?: (channel: string) => Promise<StreamInfoProbe>;
}
export interface FarmingAutomationTwitchAdapter {
  readonly refresh: (
    forceSessionRefresh?: boolean,
    options?: FarmingAutomationRefreshOptions,
  ) => Promise<FarmingAutomationRefreshResult>;
  readonly fetchDirectory: (
    game: TwitchGame,
    language?: string,
    options?: FarmingAutomationDirectoryRequestOptions,
  ) => Promise<FarmingAutomationDirectoryResult>;
  readonly probeStreamInfo?: (channel: string) => Promise<StreamInfoProbe>;
}

export class FarmingAutomationCampaignRefreshError extends Error {
  readonly name = 'FarmingAutomationCampaignRefreshError';
  constructor(readonly cause: unknown) {
    super('Twitch campaign snapshot refresh failed');
  }
}

export class FarmingAutomationRefreshBackoffError extends Error {
  readonly name = 'FarmingAutomationRefreshBackoffError';
  constructor(readonly retryAt: number) {
    super('Twitch refresh is waiting for its scheduled retry');
  }
}

export class FarmingAutomationInventoryRefreshError extends Error {
  readonly name = 'FarmingAutomationInventoryRefreshError';
  constructor(readonly cause: unknown) {
    super('Twitch inventory snapshot refresh failed');
  }
}

export class FarmingAutomationDirectoryRefreshError extends Error {
  readonly name = 'FarmingAutomationDirectoryRefreshError';
  constructor(readonly cause: unknown) {
    super('Twitch directory refresh failed');
  }
}

export class FarmingAutomationSessionMissingError extends Error {
  readonly name = 'FarmingAutomationSessionMissingError';

  constructor() {
    super('Twitch session is unavailable.');
  }
}

export function deriveSafeRefreshPatch(
  snapshot: FarmingAutomationTwitchSnapshot,
): FarmingAutomationRefreshPatch {
  return Object.freeze({
    availableGames: snapshot.games,
    allDrops: snapshot.drops,
    campaignDropsByKey: snapshot.campaignDropsByKey,
    campaignChannelsMap: snapshot.campaignChannelsMap,
  });
}

function mergeSnapshots(campaigns: DropsSnapshot, inventory: DropsSnapshot): DropsSnapshot {
  return {
    games: [...campaigns.games, ...inventory.games],
    drops: [...campaigns.drops, ...inventory.drops],
    campaignChannelsMap: { ...campaigns.campaignChannelsMap, ...inventory.campaignChannelsMap },
    updatedAt: Math.max(campaigns.updatedAt, inventory.updatedAt),
  };
}

export function createFarmingAutomationTwitchAdapter(
  source: FarmingAutomationTwitchSource,
): FarmingAutomationTwitchAdapter {
  const refresh = async (
    forceSessionRefresh = false,
    options: FarmingAutomationRefreshOptions = {},
  ): Promise<FarmingAutomationRefreshResult> => {
    source.assertCanRefresh?.(options);
    const refreshStartedAt = Date.now();
    let session = await source.loadSession(forceSessionRefresh);
    if (!session?.userId.trim() && !options.requireFreshCompleteSnapshot) {
      return Object.freeze({ kind: 'session-missing' as const });
    }

    let campaignSnapshot: DropsSnapshot | null;
    let snapshotSessionUserId: string | null = null;
    try {
      campaignSnapshot = await source.fetchCampaignSnapshot(session, {
        ...options,
        ...(options.requireFreshCompleteSnapshot
          ? { onSessionResolved: (userId: string) => (snapshotSessionUserId = userId) }
          : {}),
      });
    } catch (cause) {
      if (cause instanceof FarmingAutomationRefreshBackoffError) throw cause;
      throw new FarmingAutomationCampaignRefreshError(cause);
    }
    source.assertCanRefresh?.(options);
    if (options.requireFreshCompleteSnapshot) {
      session = await source.loadSession(false);
      if (session && snapshotSessionUserId && session.userId !== snapshotSessionUserId) {
        throw new FarmingAutomationCampaignRefreshError('Twitch account changed during campaign refresh.');
      }
    }
    if (!session?.userId.trim()) return Object.freeze({ kind: 'session-missing' as const });
    if (!campaignSnapshot) throw new FarmingAutomationCampaignRefreshError('Empty Twitch campaign snapshot');

    if (options.requireFreshCompleteSnapshot) {
      if (campaignSnapshot.inventoryVerified !== true) {
        throw new FarmingAutomationInventoryRefreshError('Twitch inventory snapshot is incomplete.');
      }
      if (campaignSnapshot.campaignsVerified !== true) {
        throw new FarmingAutomationCampaignRefreshError('Twitch campaign snapshot is incomplete.');
      }
      if (campaignSnapshot.updatedAt < refreshStartedAt) {
        throw new FarmingAutomationCampaignRefreshError('Twitch campaign snapshot is stale.');
      }
    }

    let combinedSnapshot = campaignSnapshot;
    if (source.fetchInventorySnapshot && !source.campaignSnapshotIncludesInventory?.(campaignSnapshot)) {
      let inventorySnapshot: DropsSnapshot | null;
      try {
        inventorySnapshot = await source.fetchInventorySnapshot(session, campaignSnapshot.drops);
      } catch (cause) {
        throw new FarmingAutomationInventoryRefreshError(cause);
      }
      if (!inventorySnapshot) {
        throw new FarmingAutomationInventoryRefreshError('Empty Twitch inventory snapshot');
      }
      combinedSnapshot = mergeSnapshots(campaignSnapshot, inventorySnapshot);
    }

    let snapshot: FarmingAutomationTwitchSnapshot;
    try {
      snapshot = normalizeFarmingAutomationSnapshot(combinedSnapshot);
    } catch (cause) {
      throw new FarmingAutomationCampaignRefreshError(cause);
    }
    return Object.freeze({
      kind: 'ready' as const,
      snapshot,
      refreshPatch: deriveSafeRefreshPatch(snapshot),
      sessionUserId: session.userId,
    });
  };

  const fetchDirectory = async (
    game: TwitchGame,
    language = '',
    options?: FarmingAutomationDirectoryRequestOptions,
  ): Promise<FarmingAutomationDirectoryResult> => {
    const session = await source.loadSession(false);
    if (!session?.userId.trim()) return Object.freeze({ kind: 'session-missing' as const });
    let response: FarmingAutomationDirectoryResponse;
    try {
      response = await source.fetchDirectoryStreamers(game, session, language, options);
      return Object.freeze({
        kind: 'ready',
        target: Object.freeze({
          campaignKey: gameKey(game),
          campaignId: game.campaignId ?? null,
          gameId: game.id,
          gameName: game.name,
          categoryId: game.categoryId ?? null,
          categorySlug: game.categorySlug?.trim() || toSlug(game.name),
        }),
        streamers: Object.freeze(response.streamers.map((streamer) => Object.freeze({ ...streamer }))),
        languageFilterApplied: response.languageFilterApplied,
      });
    } catch (cause) {
      throw new FarmingAutomationDirectoryRefreshError(cause);
    }
  };

  return { refresh, fetchDirectory, probeStreamInfo: source.probeStreamInfo };
}
