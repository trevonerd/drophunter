import type { TwitchDrop } from '../../types/index.ts';
import {
  buildConflictedRewardBenefitKeys,
  classifyRewardKind,
  extractRecordArray,
  normalizeText,
  rewardBenefitKey,
  toIsoDate,
} from './parsing.ts';

export type ClaimedRewardAwardedAt =
  | { kind: 'valid'; value: string }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export interface ClaimedRewardEntry {
  nameCounts: Map<string, number>;
  idCounts: Map<string, number>;
  idAwardedAt: Map<string, ClaimedRewardAwardedAt[]>;
}

// Null scopes an award to Twitch itself, rather than a game (badges and emotes).
export type ClaimedRewardLookup = Map<string | null, ClaimedRewardEntry>;

export type StrictGameEventRewardProof = {
  readonly benefitIds: readonly string[];
  readonly gameName: string;
  readonly window: { readonly startsAt: string | null; readonly endsAt: string | null };
  readonly conflictedBenefitKeys: ReadonlySet<string>;
};

function createClaimedRewardEntry(): ClaimedRewardEntry {
  return { nameCounts: new Map(), idCounts: new Map(), idAwardedAt: new Map() };
}

function addClaimedReward(
  entry: ClaimedRewardEntry,
  rewardName: string,
  benefitId: string,
  awardedAt: ClaimedRewardAwardedAt,
) {
  if (rewardName) {
    entry.nameCounts.set(rewardName, (entry.nameCounts.get(rewardName) ?? 0) + 1);
  }
  if (benefitId) {
    entry.idCounts.set(benefitId, (entry.idCounts.get(benefitId) ?? 0) + 1);
    entry.idAwardedAt.set(benefitId, [...(entry.idAwardedAt.get(benefitId) ?? []), awardedAt]);
  }
}

function normalizeAwardedAt(value: unknown): ClaimedRewardAwardedAt {
  if (typeof value !== 'string' || !value.trim()) {
    return { kind: 'missing' };
  }
  const awardedAt = toIsoDate(value);
  return awardedAt ? { kind: 'valid', value: awardedAt } : { kind: 'invalid' };
}

export function buildClaimedRewardLookup(inventoryRaw: unknown): ClaimedRewardLookup {
  const lookup: ClaimedRewardLookup = new Map();

  if (!inventoryRaw || typeof inventoryRaw !== 'object' || !('gameEventDrops' in inventoryRaw)) {
    return lookup;
  }

  for (const drop of extractRecordArray(inventoryRaw.gameEventDrops)) {
    const gameObj = drop.game;
    if (gameObj === undefined) continue;
    let gameName: string | null = null;
    if (gameObj !== null) {
      if (typeof gameObj !== 'object' || Array.isArray(gameObj)) continue;
      gameName = (
        normalizeText('displayName' in gameObj ? gameObj.displayName : undefined) ||
        normalizeText('name' in gameObj ? gameObj.name : undefined)
      ).toLowerCase();
      if (!gameName) continue;
    }
    const rewardName = normalizeText(drop.name).toLowerCase();
    const benefitId = normalizeText(drop.id);
    const awardedAt = normalizeAwardedAt(drop.lastAwardedAt);

    if (!rewardName && !benefitId) continue;
    const entry = lookup.get(gameName) ?? createClaimedRewardEntry();
    addClaimedReward(entry, rewardName, benefitId, awardedAt);
    lookup.set(gameName, entry);
  }

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
    const awardedAt = normalizeAwardedAt(drop.lastAwardedAt);
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
  benefitIds: readonly string[],
  window: { startsAt: string | null; endsAt: string | null },
  allowMissingTimestamp = true,
): boolean {
  if (!entry) {
    return false;
  }
  for (const id of benefitIds) {
    const awardedAtValues = entry.idAwardedAt.get(id);
    if (!awardedAtValues || awardedAtValues.length === 0) {
      if (allowMissingTimestamp && (entry.idCounts.get(id) ?? 0) > 0) {
        return true;
      }
      continue;
    }
    if (
      awardedAtValues.some(
        (awardedAt) =>
          (allowMissingTimestamp && awardedAt.kind === 'missing') ||
          (awardedAt.kind === 'valid' && awardWithinWindow(awardedAt.value, window.startsAt, window.endsAt)),
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
  allowMissingGlobalAwardedAt = allowGlobalIdMatch,
): { idMatch: boolean; nameMatch: boolean; globalIdMatch: boolean } {
  const idMatch = entryHasAwardedBenefit(gameClaimedRewards, benefitIds, window);
  const nameMatch = false;
  const globalIdMatch =
    !idMatch &&
    !nameMatch &&
    gameClaimedRewards == null &&
    allowGlobalIdMatch &&
    entryHasAwardedBenefit(globalClaimedRewards, benefitIds, window, allowMissingGlobalAwardedAt);

  return { idMatch, nameMatch, globalIdMatch };
}

export function isEarlyAwardableTwitchReward(rewardDistributionTypes?: string[]): boolean {
  const rewardKind = classifyRewardKind(rewardDistributionTypes ?? []);
  return rewardKind === 'twitch-badge' || rewardKind === 'twitch-emote';
}

// Native awards may have game:null. Their exact benefit must be unique across
// campaigns, with a real timestamp inside the reward window; named games stay scoped.
export function hasClaimedGameEventReward(
  claimedRewards: ClaimedRewardLookup,
  proof: StrictGameEventRewardProof,
): boolean {
  const { benefitIds, gameName, window, conflictedBenefitKeys } = proof;
  if (!window.startsAt || !window.endsAt) return false;

  const startsAtMs = new Date(window.startsAt).getTime();
  const endsAtMs = new Date(window.endsAt).getTime();
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || startsAtMs >= endsAtMs) {
    return false;
  }
  if (benefitIds.some((benefitId) => conflictedBenefitKeys.has(rewardBenefitKey(gameName, benefitId)))) {
    return false;
  }

  const gameClaimedRewards = claimedRewards.get(gameName.toLowerCase());
  if (entryHasAwardedBenefit(gameClaimedRewards, benefitIds, window, false)) return true;
  if (benefitIds.some((benefitId) => conflictedBenefitKeys.has(rewardBenefitKey('', benefitId)))) {
    return false;
  }
  return entryHasAwardedBenefit(claimedRewards.get(null), benefitIds, window, false);
}

export function resolveDropClaimedStatus(
  claimedFromInventory: boolean,
  claimedFromGameEvents: boolean,
  strictClaimedFromGameEvents: boolean,
  hasInventoryState: boolean,
  isEarlyAwardable: boolean,
): boolean {
  if (isEarlyAwardable) {
    return claimedFromInventory || strictClaimedFromGameEvents;
  }
  if (hasInventoryState) return claimedFromInventory;
  return claimedFromInventory || claimedFromGameEvents;
}

export function applyEarlyTwitchRewardClaimsToDrops(
  drops: TwitchDrop[],
  inventoryRaw: unknown,
): TwitchDrop[] {
  const claimedRewards = buildClaimedRewardLookup(inventoryRaw);
  const conflictedBenefitKeys = buildConflictedRewardBenefitKeys(
    drops.map((drop) => ({
      gameName: drop.gameName,
      campaignIdentity: drop.campaignId ?? drop.id,
      benefitIds: drop.benefitIds ?? [],
    })),
  );

  return drops.map((drop) => {
    const classifiedRewardKind = classifyRewardKind(drop.rewardDistributionTypes ?? []);
    const rewardKind = classifiedRewardKind === 'unknown' ? drop.rewardKind : classifiedRewardKind;
    const isTwitchNative = rewardKind === 'twitch-badge' || rewardKind === 'twitch-emote';
    const normalizedDrop: TwitchDrop = {
      ...drop,
      rewardKind,
      verificationState: isTwitchNative ? drop.verificationState : 'unassessed',
    };

    if (!isTwitchNative || normalizedDrop.verificationState === 'verified') return normalizedDrop;

    const benefitIds = drop.benefitIds ?? [];
    if (benefitIds.length === 0) return normalizedDrop;

    const claimedFromGameEvents = hasClaimedGameEventReward(claimedRewards, {
      benefitIds,
      gameName: drop.gameName,
      window: { startsAt: drop.startsAt ?? null, endsAt: drop.endsAt ?? null },
      conflictedBenefitKeys,
    });

    if (!claimedFromGameEvents) return normalizedDrop;

    return {
      ...normalizedDrop,
      claimed: true,
      claimable: false,
      progress: 100,
      remainingMinutes: 0,
      status: 'completed',
      verificationState: 'verified',
    };
  });
}
