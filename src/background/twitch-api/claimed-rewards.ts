import { logVerboseInfo } from '../logging.ts';
import { normalizeText } from './parsing.ts';

export interface ClaimedRewardEntry {
  nameCounts: Map<string, number>;
  idCounts: Map<string, number>;
}

export type ClaimedRewardLookup = Map<string, ClaimedRewardEntry>;

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

    if (!gameName || (!rewardName && !benefitId)) return;

    if (!lookup.has(gameName)) {
      lookup.set(gameName, { nameCounts: new Map(), idCounts: new Map() });
    }
    const entry = lookup.get(gameName)!;
    if (rewardName) entry.nameCounts.set(rewardName, (entry.nameCounts.get(rewardName) ?? 0) + 1);
    if (benefitId) entry.idCounts.set(benefitId, (entry.idCounts.get(benefitId) ?? 0) + 1);
    logVerboseInfo(
      `[buildClaimedRewardLookup] game="${gameName}" claimedName="${rewardName}" benefitId="${benefitId}"`,
    );
  });

  lookup.forEach((entry, gameName) => {
    const nameEntries = Array.from(entry.nameCounts.entries())
      .map(([name, count]) => `${name}(x${count})`)
      .join(', ');
    const idEntries = Array.from(entry.idCounts.entries())
      .map(([id, count]) => `${id}(x${count})`)
      .join(', ');
    logVerboseInfo(
      `[buildClaimedRewardLookup] SUMMARY game="${gameName}" claimedNames=[${nameEntries}] claimedIdCounts=[${idEntries}]`,
    );
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

export function matchClaimedReward(
  benefitIds: string[],
  benefitNames: string[],
  gameClaimedRewards: ClaimedRewardEntry | undefined,
  globalClaimedIdCounts: Set<string>,
): { idMatch: boolean; nameMatch: boolean; globalIdMatch: boolean } {
  let idMatch = false;
  if (gameClaimedRewards != null) {
    for (const id of benefitIds) {
      const remaining = gameClaimedRewards.idCounts.get(id) ?? 0;
      if (remaining > 0) {
        idMatch = true;
        gameClaimedRewards.idCounts.set(id, remaining - 1);
        break;
      }
    }
  }

  let nameMatch = false;
  if (!idMatch && gameClaimedRewards != null) {
    for (const name of benefitNames) {
      const remaining = gameClaimedRewards.nameCounts.get(name) ?? 0;
      if (remaining > 0) {
        nameMatch = true;
        gameClaimedRewards.nameCounts.set(name, remaining - 1);
        break;
      }
    }
  }

  let globalIdMatch = false;
  if (!idMatch && !nameMatch && gameClaimedRewards == null) {
    for (const id of benefitIds) {
      if (globalClaimedIdCounts.has(id)) {
        globalIdMatch = true;
        break;
      }
    }
  }

  return { idMatch, nameMatch, globalIdMatch };
}
