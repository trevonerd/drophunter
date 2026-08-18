import { mergeDropProgressMonotonic } from '../shared/drops.ts';
import { dedupeGamesByIdentity, gameKey } from '../shared/game-selection.ts';
import type { DropsSnapshot, TwitchDrop, TwitchGame } from '../types/index.ts';

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
