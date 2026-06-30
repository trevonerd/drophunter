import { browser } from '../shared/browser-api.ts';
import { getGameDisplayLabel } from '../shared/game-selection.ts';
import type { AppState, ClaimLogEntry, TwitchDrop, TwitchGame } from '../types/index.ts';
import { CLAIM_LOG_KEY } from './constants.ts';
import { dropStateKey } from './drops-projection.ts';
import { logDebug, logWarn } from './logging.ts';

export const CLAIM_LOG_MAX_ENTRIES = 5000;

let writeQueue: Promise<unknown> = Promise.resolve();

type ClaimRecordedHandler = (entries: ClaimLogEntry[]) => void | Promise<void>;
let claimRecordedHandler: ClaimRecordedHandler | null = null;

export function setClaimRecordedHandler(handler: ClaimRecordedHandler | null): void {
  claimRecordedHandler = handler;
}

export function normalizeClaimLogEntry(raw: unknown): ClaimLogEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.dropId !== 'string' || !r.dropId) return null;
  if (typeof r.claimedAt !== 'number' || !Number.isFinite(r.claimedAt)) return null;
  const dropName = typeof r.dropName === 'string' && r.dropName ? r.dropName : (r.dropId as string);
  const gameName = typeof r.gameName === 'string' && r.gameName ? r.gameName : '';
  const campaignLabel = typeof r.campaignLabel === 'string' && r.campaignLabel ? r.campaignLabel : dropName;
  return {
    id: r.id,
    claimId: typeof r.claimId === 'string' ? r.claimId : undefined,
    dropId: r.dropId,
    dropName,
    benefitName: typeof r.benefitName === 'string' ? r.benefitName : undefined,
    gameId: typeof r.gameId === 'string' ? r.gameId : '',
    gameName,
    campaignId: typeof r.campaignId === 'string' ? r.campaignId : undefined,
    campaignName: typeof r.campaignName === 'string' ? r.campaignName : undefined,
    campaignLabel,
    claimedAt: r.claimedAt,
    imageUrl: typeof r.imageUrl === 'string' && r.imageUrl ? r.imageUrl : undefined,
  };
}

export function createClaimLogEntry(
  drop: TwitchDrop,
  availableGames: TwitchGame[],
  claimedAt = Date.now(),
): ClaimLogEntry {
  const matchedGame = drop.campaignId
    ? availableGames.find((g) => g.campaignId === drop.campaignId)
    : undefined;

  const campaignLabel =
    (matchedGame ? getGameDisplayLabel(matchedGame) : undefined) || drop.gameName || drop.name;
  const campaignName = matchedGame?.campaignName;

  const id = dropStateKey(drop);

  return {
    id,
    claimId: drop.claimId,
    dropId: drop.id,
    dropName: drop.name || drop.id,
    benefitName: drop.benefitName,
    gameId: drop.gameId || '',
    gameName: drop.gameName || '',
    campaignId: drop.campaignId,
    campaignName,
    campaignLabel,
    claimedAt,
    imageUrl: drop.imageUrl || undefined,
  };
}

export async function loadClaimLog(): Promise<ClaimLogEntry[]> {
  try {
    const stored = await browser.storage.local.get([CLAIM_LOG_KEY]);
    const raw = stored[CLAIM_LOG_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeClaimLogEntry).filter((e): e is ClaimLogEntry => e !== null);
  } catch (error) {
    logWarn('Failed to load claim log:', String(error));
    return [];
  }
}

export async function appendClaimLogEntries(
  entries: ClaimLogEntry[],
  maxEntries = CLAIM_LOG_MAX_ENTRIES,
): Promise<{ added: number; entries: ClaimLogEntry[] }> {
  const result = (writeQueue as Promise<unknown>).then(async () => {
    try {
      const existing = await loadClaimLog();
      const existingIds = new Set(existing.map((e) => e.id));
      const toAdd = entries.filter((e) => !existingIds.has(e.id));
      if (toAdd.length === 0) {
        logDebug('appendClaimLogEntries: no new entries to add');
        return { added: 0, entries: [] as ClaimLogEntry[] };
      }
      const combined = [...existing, ...toAdd];
      const trimmed =
        combined.length > maxEntries
          ? combined.sort((a, b) => a.claimedAt - b.claimedAt).slice(-maxEntries)
          : combined;
      await browser.storage.local.set({ [CLAIM_LOG_KEY]: trimmed });
      return { added: toAdd.length, entries: toAdd };
    } catch (error) {
      logWarn('Failed to append claim log entries:', String(error));
      return { added: 0, entries: [] as ClaimLogEntry[] };
    }
  });
  writeQueue = result;
  return result as Promise<{ added: number; entries: ClaimLogEntry[] }>;
}

export async function clearClaimLog(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    try {
      await browser.storage.local.remove(CLAIM_LOG_KEY);
    } catch (error) {
      logWarn('Failed to clear claim log:', String(error));
    }
  });
  return writeQueue as Promise<void>;
}

export function detectNewlyClaimedDrops(nextDrops: TwitchDrop[], previousDrops: TwitchDrop[]): TwitchDrop[] {
  const previousByKey = new Map(previousDrops.map((drop) => [dropStateKey(drop), drop]));
  return nextDrops.filter((drop) => {
    if (!drop.claimed) return false;
    const previous = previousByKey.get(dropStateKey(drop));
    return previous !== undefined && !previous.claimed;
  });
}

export interface ClaimRecordTarget {
  appState: Pick<AppState, 'totalDropsClaimed' | 'availableGames'>;
}

export async function recordClaimedDrops(
  target: ClaimRecordTarget,
  drops: TwitchDrop[],
  claimedAt = Date.now(),
): Promise<number> {
  if (drops.length === 0) return 0;
  const entries = drops.map((drop) => createClaimLogEntry(drop, target.appState.availableGames, claimedAt));
  const { added, entries: recordedEntries } = await appendClaimLogEntries(entries);
  target.appState.totalDropsClaimed += added;
  if (added > 0 && claimRecordedHandler) {
    try {
      await claimRecordedHandler(recordedEntries);
    } catch (error) {
      logWarn('Claim recorded handler failed:', String(error));
    }
  }
  return added;
}
