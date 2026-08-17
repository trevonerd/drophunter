import { mergeDropProgressMonotonic } from '../shared/drops.ts';
import { dedupeGamesByIdentity, gameKey } from '../shared/game-selection.ts';
import { toSlug } from '../shared/utils.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../types/index.ts';
import type { TwitchSession } from './twitch-api/types.ts';

export type FarmingAutomationNormalizedGame = Omit<Readonly<TwitchGame>, 'allowedChannels'> & {
  readonly allowedChannels?: readonly string[] | null;
};
export type FarmingAutomationNormalizedDrop = Omit<
  Readonly<TwitchDrop>,
  'benefitIds' | 'rewardDistributionTypes'
> & {
  readonly benefitIds?: readonly string[];
  readonly rewardDistributionTypes?: readonly string[];
};
export interface FarmingAutomationTwitchSnapshot {
  readonly games: readonly FarmingAutomationNormalizedGame[];
  readonly drops: readonly FarmingAutomationNormalizedDrop[];
  readonly campaignDropsByKey: Readonly<Record<string, readonly FarmingAutomationNormalizedDrop[]>>;
  readonly campaignChannelsMap: Readonly<Record<string, readonly string[] | null>>;
  readonly updatedAt: number;
}
export interface FarmingAutomationRefreshPatch {
  readonly availableGames: readonly FarmingAutomationNormalizedGame[];
  readonly allDrops: readonly FarmingAutomationNormalizedDrop[];
  readonly campaignDropsByKey: Readonly<Record<string, readonly FarmingAutomationNormalizedDrop[]>>;
  readonly campaignChannelsMap: Readonly<Record<string, readonly string[] | null>>;
}
export type FarmingAutomationRefreshResult =
  | {
      readonly kind: 'ready';
      readonly snapshot: FarmingAutomationTwitchSnapshot;
      readonly refreshPatch: FarmingAutomationRefreshPatch;
    }
  | { readonly kind: 'session-missing' };
export interface FarmingAutomationDirectoryResponse {
  readonly streamers: readonly TwitchStreamer[];
  readonly languageFilterApplied: boolean;
}
export interface FarmingAutomationDirectoryTarget {
  readonly campaignKey: string;
  readonly campaignId: string | null;
  readonly gameId: string;
  readonly gameName: string;
  readonly categoryId: string | null;
  readonly categorySlug: string;
}
export type FarmingAutomationDirectoryResult =
  | {
      readonly kind: 'ready';
      readonly target: FarmingAutomationDirectoryTarget;
      readonly streamers: readonly Readonly<TwitchStreamer>[];
      readonly languageFilterApplied: boolean;
    }
  | { readonly kind: 'session-missing' };
export interface FarmingAutomationTwitchSource {
  readonly loadSession: (forceRefresh: boolean) => Promise<TwitchSession | null>;
  readonly fetchCampaignSnapshot: (session: TwitchSession) => Promise<DropsSnapshot | null>;
  readonly fetchInventorySnapshot?: (
    session: TwitchSession,
    baseDrops: readonly TwitchDrop[],
  ) => Promise<DropsSnapshot | null>;
  readonly fetchDirectoryStreamers: (
    game: TwitchGame,
    session: TwitchSession,
    language: string,
  ) => Promise<FarmingAutomationDirectoryResponse>;
}
export interface FarmingAutomationTwitchAdapter {
  readonly refresh: (forceSessionRefresh?: boolean) => Promise<FarmingAutomationRefreshResult>;
  readonly fetchDirectory: (game: TwitchGame, language?: string) => Promise<FarmingAutomationDirectoryResult>;
}

export class FarmingAutomationCampaignRefreshError extends Error {
  readonly name = 'FarmingAutomationCampaignRefreshError';
  constructor(readonly cause: unknown) {
    super('Twitch campaign snapshot refresh failed');
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

function stableSignature(value: object): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function freezeGame(game: TwitchGame): FarmingAutomationNormalizedGame {
  const summary = game.rewardSummary;
  return Object.freeze({
    ...game,
    rewardSummary: summary
      ? Object.freeze({ ...summary, remainderReasons: Object.freeze([...summary.remainderReasons]) })
      : summary,
    allowedChannels:
      game.allowedChannels === null || game.allowedChannels === undefined
        ? game.allowedChannels
        : Object.freeze([...new Set(game.allowedChannels)].sort((left, right) => left.localeCompare(right))),
  });
}

function freezeDrop(drop: TwitchDrop): FarmingAutomationNormalizedDrop {
  return Object.freeze({
    ...drop,
    benefitIds: drop.benefitIds ? Object.freeze([...drop.benefitIds]) : drop.benefitIds,
    rewardDistributionTypes: drop.rewardDistributionTypes
      ? Object.freeze([...drop.rewardDistributionTypes])
      : drop.rewardDistributionTypes,
  });
}

function normalizeGames(games: readonly TwitchGame[]): readonly FarmingAutomationNormalizedGame[] {
  const sorted = [...games].sort((left, right) =>
    stableSignature(left).localeCompare(stableSignature(right)),
  );
  return Object.freeze(
    dedupeGamesByIdentity(sorted)
      .sort((left, right) => gameKey(left).localeCompare(gameKey(right)))
      .map(freezeGame),
  );
}

function mergeDuplicateDrops(drops: readonly TwitchDrop[]): FarmingAutomationNormalizedDrop {
  const merged: TwitchDrop = drops.reduce((left, right) => {
    const progress =
      left.claimed || right.claimed || left.claimable || right.claimable
        ? 100
        : Math.max(left.progress, right.progress);
    const currentMinutes = Math.max(left.currentMinutes, right.currentMinutes);
    const next = mergeDropProgressMonotonic(right, left);
    return {
      ...next,
      progress,
      currentMinutes,
      benefitIds: [...new Set(drops.flatMap((drop) => drop.benefitIds ?? []))].sort(),
      rewardDistributionTypes: [
        ...new Set(drops.flatMap((drop) => drop.rewardDistributionTypes ?? [])),
      ].sort(),
    };
  });
  return freezeDrop(merged);
}

function normalizeDrops(drops: readonly TwitchDrop[]): readonly FarmingAutomationNormalizedDrop[] {
  const groups = new Map<string, TwitchDrop[]>();
  for (const drop of drops) {
    const key = `${drop.id}::${drop.campaignId ?? ''}`;
    const current = groups.get(key) ?? [];
    current.push(drop);
    groups.set(key, current);
  }
  return Object.freeze(
    Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entries]) =>
        mergeDuplicateDrops(
          entries.slice().sort((left, right) => stableSignature(left).localeCompare(stableSignature(right))),
        ),
      ),
  );
}

function normalizeChannels(
  channels: DropsSnapshot['campaignChannelsMap'],
): Readonly<Record<string, readonly string[] | null>> {
  const normalized: Record<string, readonly string[] | null> = {};
  for (const [campaignId, values] of Object.entries(channels ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    normalized[campaignId] =
      values === null
        ? null
        : Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
  }
  return Object.freeze(normalized);
}

function normalizeCampaignDrops(
  drops: readonly FarmingAutomationNormalizedDrop[],
): Readonly<Record<string, readonly FarmingAutomationNormalizedDrop[]>> {
  const grouped: Record<string, FarmingAutomationNormalizedDrop[]> = {};
  for (const drop of drops) {
    const key = drop.campaignId ? `campaign:${drop.campaignId}` : `id:${drop.gameId}`;
    grouped[key] = [...(grouped[key] ?? []), drop];
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(grouped)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, values]) => [key, Object.freeze(values)]),
    ),
  );
}

export function normalizeFarmingAutomationSnapshot(snapshot: DropsSnapshot): FarmingAutomationTwitchSnapshot {
  const games = normalizeGames(snapshot.games);
  const drops = normalizeDrops(snapshot.drops);
  return Object.freeze({
    games,
    drops,
    campaignDropsByKey: normalizeCampaignDrops(drops),
    campaignChannelsMap: normalizeChannels(snapshot.campaignChannelsMap),
    updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : 0,
  });
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
  const refresh = async (forceSessionRefresh = false): Promise<FarmingAutomationRefreshResult> => {
    const session = await source.loadSession(forceSessionRefresh);
    if (!session) return Object.freeze({ kind: 'session-missing' as const });

    let campaignSnapshot: DropsSnapshot | null;
    try {
      campaignSnapshot = await source.fetchCampaignSnapshot(session);
    } catch (cause) {
      throw new FarmingAutomationCampaignRefreshError(cause);
    }
    if (!campaignSnapshot) throw new FarmingAutomationCampaignRefreshError('Empty Twitch campaign snapshot');

    let combinedSnapshot = campaignSnapshot;
    if (source.fetchInventorySnapshot) {
      try {
        const inventorySnapshot = await source.fetchInventorySnapshot(session, campaignSnapshot.drops);
        if (inventorySnapshot) combinedSnapshot = mergeSnapshots(campaignSnapshot, inventorySnapshot);
      } catch (cause) {
        throw new FarmingAutomationInventoryRefreshError(cause);
      }
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
    });
  };

  const fetchDirectory = async (
    game: TwitchGame,
    language = '',
  ): Promise<FarmingAutomationDirectoryResult> => {
    const session = await source.loadSession(false);
    if (!session) return Object.freeze({ kind: 'session-missing' as const });
    let response: FarmingAutomationDirectoryResponse;
    try {
      response = await source.fetchDirectoryStreamers(game, session, language);
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

  return { refresh, fetchDirectory };
}
