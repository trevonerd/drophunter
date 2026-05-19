import { normalizeText, toIsoDate } from './parsing.ts';

export interface ClaimedRewardEntry {
  nameCounts: Map<string, number>;
  idCounts: Map<string, number>;
  idAwardedAt: Map<string, Array<string | null>>;
}

export type ClaimedRewardLookup = Map<string, ClaimedRewardEntry>;

function createClaimedRewardEntry(): ClaimedRewardEntry {
  return { nameCounts: new Map(), idCounts: new Map(), idAwardedAt: new Map() };
}

function addClaimedReward(
  entry: ClaimedRewardEntry,
  rewardName: string,
  benefitId: string,
  awardedAt: string | null,
) {
  if (rewardName) {
    entry.nameCounts.set(rewardName, (entry.nameCounts.get(rewardName) ?? 0) + 1);
  }
  if (benefitId) {
    entry.idCounts.set(benefitId, (entry.idCounts.get(benefitId) ?? 0) + 1);
    entry.idAwardedAt.set(benefitId, [...(entry.idAwardedAt.get(benefitId) ?? []), awardedAt]);
  }
}

export function buildClaimedRewardLookup(inventoryRaw: unknown): ClaimedRewardLookup {
  const lookup: ClaimedRewardLookup = new Map();

  if (!inventoryRaw || typeof inventoryRaw !== 'object') {
    return lookup;
  }

  const inventory = inventoryRaw as Record<string, unknown>;
  const gameEventDrops = Array.isArray(inventory.gameEventDrops)
    ? (inventory.gameEventDrops as Array<Record<string, unknown>>)
    : [];

  gameEventDrops.forEach((drop) => {
    if (!drop || typeof drop !== 'object') return;

    const gameObj = drop.game;
    if (!gameObj || typeof gameObj !== 'object') return;

    const gameRec = gameObj as Record<string, unknown>;
    const gameName = (normalizeText(gameRec.displayName) || normalizeText(gameRec.name)).toLowerCase();
    const rewardName = normalizeText(drop.name).toLowerCase();
    const benefitId = normalizeText(drop.id);
    const awardedAt = toIsoDate(drop.lastAwardedAt);

    if (!gameName || (!rewardName && !benefitId)) return;

    if (!lookup.has(gameName)) {
      lookup.set(gameName, createClaimedRewardEntry());
    }
    const entry = lookup.get(gameName)!;
    addClaimedReward(entry, rewardName, benefitId, awardedAt);
  });

  return lookup;
}

export function buildGlobalClaimedIdCounts(inventoryRaw: unknown): Set<string> {
  const ids = new Set<string>();
  if (!inventoryRaw || typeof inventoryRaw !== 'object') return ids;
  const inventory = inventoryRaw as Record<string, unknown>;
  const gameEventDrops = Array.isArray(inventory.gameEventDrops)
    ? (inventory.gameEventDrops as Array<Record<string, unknown>>)
    : [];
  gameEventDrops.forEach((drop) => {
    if (!drop || typeof drop !== 'object') return;
    const benefitId = normalizeText(drop.id);
    if (benefitId) ids.add(benefitId);
  });
  return ids;
}

export function buildGlobalClaimedRewardEntry(inventoryRaw: unknown): ClaimedRewardEntry {
  const entry = createClaimedRewardEntry();
  if (!inventoryRaw || typeof inventoryRaw !== 'object') return entry;
  const inventory = inventoryRaw as Record<string, unknown>;
  const gameEventDrops = Array.isArray(inventory.gameEventDrops)
    ? (inventory.gameEventDrops as Array<Record<string, unknown>>)
    : [];
  gameEventDrops.forEach((drop) => {
    if (!drop || typeof drop !== 'object') return;
    const rewardName = normalizeText(drop.name).toLowerCase();
    const benefitId = normalizeText(drop.id);
    const awardedAt = toIsoDate(drop.lastAwardedAt);
    addClaimedReward(entry, rewardName, benefitId, awardedAt);
  });
  return entry;
}

function awardWithinWindow(awardedAt: string, startsAt: string | null, endsAt: string | null): boolean {
  const awardedAtMs = new Date(awardedAt).getTime();
  if (!Number.isFinite(awardedAtMs)) {
    return false;
  }
  const startsAtMs = startsAt ? new Date(startsAt).getTime() : Number.NEGATIVE_INFINITY;
  const endsAtMs = endsAt ? new Date(endsAt).getTime() : Number.POSITIVE_INFINITY;
  return awardedAtMs >= startsAtMs && awardedAtMs < endsAtMs;
}

function entryHasAwardedBenefit(
  entry: ClaimedRewardEntry | undefined,
  benefitIds: string[],
  window: { startsAt: string | null; endsAt: string | null },
): boolean {
  if (!entry) {
    return false;
  }
  for (const id of benefitIds) {
    const awardedAtValues = entry.idAwardedAt.get(id);
    if (!awardedAtValues || awardedAtValues.length === 0) {
      if ((entry.idCounts.get(id) ?? 0) > 0) {
        return true;
      }
      continue;
    }
    if (
      awardedAtValues.some(
        (awardedAt) => awardedAt === null || awardWithinWindow(awardedAt, window.startsAt, window.endsAt),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function matchClaimedReward(
  benefitIds: string[],
  _benefitNames: string[],
  gameClaimedRewards: ClaimedRewardEntry | undefined,
  globalClaimedRewards: ClaimedRewardEntry,
  window: { startsAt: string | null; endsAt: string | null },
  allowGlobalIdMatch: boolean,
): { idMatch: boolean; nameMatch: boolean; globalIdMatch: boolean } {
  const idMatch = entryHasAwardedBenefit(gameClaimedRewards, benefitIds, window);
  const nameMatch = false;
  const globalIdMatch =
    !idMatch &&
    !nameMatch &&
    gameClaimedRewards == null &&
    allowGlobalIdMatch &&
    entryHasAwardedBenefit(globalClaimedRewards, benefitIds, window);

  return { idMatch, nameMatch, globalIdMatch };
}
