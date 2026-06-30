import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { setupChromeMocks } from './mocks/chrome.ts';
import type { ChromeMocks } from './mocks/chrome.ts';
import {
  normalizeClaimLogEntry,
  createClaimLogEntry,
  loadClaimLog,
  appendClaimLogEntries,
  clearClaimLog,
  detectNewlyClaimedDrops,
  recordClaimedDrops,
  setClaimRecordedHandler,
} from '../src/background/claim-log.ts';
import type { ClaimLogEntry } from '../src/types/index.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function makeDrop(overrides: Partial<TwitchDrop> = {}): TwitchDrop {
  return {
    id: 'drop-1',
    claimId: 'claim-1',
    name: 'Test Drop',
    gameName: 'Test Game',
    gameId: 'game-1',
    imageUrl: '',
    campaignId: 'camp-1',
    progress: 100,
    currentMinutes: 60,
    claimed: true,
    claimable: false,
    ...overrides,
  };
}

function makeGame(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-1',
    name: 'Test Game',
    imageUrl: '',
    campaignId: 'camp-1',
    campaignName: 'Test Campaign',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ClaimLogEntry> = {}): ClaimLogEntry {
  return {
    id: 'claim-1',
    claimId: 'claim-1',
    dropId: 'drop-1',
    dropName: 'Test Drop',
    gameId: 'game-1',
    gameName: 'Test Game',
    campaignId: 'camp-1',
    campaignLabel: 'Test Game',
    claimedAt: 1000,
    ...overrides,
  };
}

let mocks: ChromeMocks;

describe('normalizeClaimLogEntry', () => {
  test('returns null for non-object', () => {
    expect(normalizeClaimLogEntry(null)).toBeNull();
    expect(normalizeClaimLogEntry('string')).toBeNull();
    expect(normalizeClaimLogEntry(42)).toBeNull();
    expect(normalizeClaimLogEntry([])).toBeNull();
  });

  test('returns null for missing required fields', () => {
    expect(normalizeClaimLogEntry({})).toBeNull();
    // missing claimedAt
    expect(normalizeClaimLogEntry({ id: 'x', dropId: 'd' })).toBeNull();
    // missing dropId
    expect(normalizeClaimLogEntry({ id: 'x', claimedAt: 1 })).toBeNull();
    // missing id
    expect(normalizeClaimLogEntry({ dropId: 'd', claimedAt: 1 })).toBeNull();
  });

  test('returns null when claimedAt is non-finite', () => {
    expect(normalizeClaimLogEntry({ id: 'x', dropId: 'd', claimedAt: NaN })).toBeNull();
    expect(normalizeClaimLogEntry({ id: 'x', dropId: 'd', claimedAt: Infinity })).toBeNull();
  });

  test('returns valid entry for minimal valid input (only id+dropId+claimedAt)', () => {
    const result = normalizeClaimLogEntry({ id: 'x', dropId: 'd', claimedAt: 12345 });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('x');
    expect(result?.dropId).toBe('d');
    expect(result?.claimedAt).toBe(12345);
  });

  test('defaults missing display fields instead of rejecting entry', () => {
    const result = normalizeClaimLogEntry({ id: 'x', dropId: 'd', claimedAt: 1 });
    expect(result).not.toBeNull();
    // dropName falls back to dropId
    expect(result?.dropName).toBe('d');
    // gameName defaults empty
    expect(result?.gameName).toBe('');
    // campaignLabel falls back to dropName
    expect(result?.campaignLabel).toBe('d');
    // gameId defaults empty
    expect(result?.gameId).toBe('');
  });

  test('passes through optional fields', () => {
    const raw = {
      id: 'x', dropId: 'd', dropName: 'n', gameId: 'g', gameName: 'g2',
      campaignLabel: 'l', claimedAt: 1, claimId: 'c1', benefitName: 'b1',
      campaignId: 'camp1', campaignName: 'cn',
    };
    const result = normalizeClaimLogEntry(raw);
    expect(result?.claimId).toBe('c1');
    expect(result?.benefitName).toBe('b1');
    expect(result?.campaignId).toBe('camp1');
    expect(result?.campaignName).toBe('cn');
  });
});

describe('createClaimLogEntry', () => {
  test('resolves campaign from availableGames by campaignId', () => {
    const drop = makeDrop({ campaignId: 'camp-1' });
    const games = [makeGame({ campaignId: 'camp-1', campaignName: 'My Campaign', name: 'My Game' })];
    const entry = createClaimLogEntry(drop, games, 999);
    expect(entry.campaignId).toBe('camp-1');
    expect(entry.campaignName).toBe('My Campaign');
    expect(entry.claimedAt).toBe(999);
  });

  test('falls back to gameName when no matching campaign', () => {
    const drop = makeDrop({ campaignId: 'unknown-camp' });
    const entry = createClaimLogEntry(drop, [], 1000);
    expect(entry.campaignLabel).toBe('Test Game');
    expect(entry.campaignName).toBeUndefined();
  });

  test('falls back to gameName when no campaignId on drop', () => {
    const drop = makeDrop({ campaignId: undefined });
    const entry = createClaimLogEntry(drop, [], 1000);
    expect(entry.campaignLabel).toBe('Test Game');
  });

  test('id is stable dropStateKey regardless of claimId', () => {
    // id = `${drop.id}::${drop.campaignId ?? ''}`
    const drop = makeDrop({ id: 'drop-1', campaignId: 'camp-1', claimId: 'c123' });
    const entry = createClaimLogEntry(drop, [], 1000);
    expect(entry.id).toBe('drop-1::camp-1');
    // claimId preserved as data field
    expect(entry.claimId).toBe('c123');
  });

  test('id stable when claimId absent', () => {
    const drop = makeDrop({ id: 'drop-99', campaignId: 'camp-1', claimId: undefined });
    const entry1 = createClaimLogEntry(drop, [], 1000);
    const entry2 = createClaimLogEntry(drop, [], 9999);
    expect(entry1.id).toBe('drop-99::camp-1');
    // same id regardless of timestamp → dedupe safe
    expect(entry1.id).toBe(entry2.id);
  });

  test('id stable when no campaignId', () => {
    const drop = makeDrop({ id: 'drop-7', campaignId: undefined });
    const entry = createClaimLogEntry(drop, [], 1000);
    expect(entry.id).toBe('drop-7::');
  });

  test('campaignLabel falls back to gameName then dropName when sparse data', () => {
    const drop = makeDrop({ gameName: '', name: 'My Drop', campaignId: undefined });
    const entry = createClaimLogEntry(drop, [], 1000);
    expect(entry.campaignLabel).toBe('My Drop');
  });
});

describe('loadClaimLog / appendClaimLogEntries / clearClaimLog', () => {
  beforeEach(() => {
    mocks = setupChromeMocks();
  });

  afterEach(() => {
    mocks.teardown();
  });

  test('loadClaimLog returns empty array when key absent', async () => {
    const result = await loadClaimLog();
    expect(result).toEqual([]);
  });

  test('loadClaimLog returns empty array when storage holds garbage', async () => {
    mocks.storage.local._store.set('claimLog', 'not-an-array');
    expect(await loadClaimLog()).toEqual([]);
    mocks.storage.local._store.set('claimLog', 42);
    expect(await loadClaimLog()).toEqual([]);
  });

  test('appendClaimLogEntries persists entries under claimLog key', async () => {
    const entry = makeEntry({ id: 'e1', claimedAt: 1000 });
    await appendClaimLogEntries([entry]);
    const loaded = await loadClaimLog();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('e1');
  });

  test('append preserves existing entries', async () => {
    const e1 = makeEntry({ id: 'e1', claimedAt: 1000 });
    const e2 = makeEntry({ id: 'e2', claimedAt: 2000 });
    await appendClaimLogEntries([e1]);
    await appendClaimLogEntries([e2]);
    const loaded = await loadClaimLog();
    expect(loaded).toHaveLength(2);
  });

  test('duplicate id is a no-op for that entry', async () => {
    const e1 = makeEntry({ id: 'e1', claimedAt: 1000, dropName: 'Original' });
    await appendClaimLogEntries([e1]);
    const e1dup = makeEntry({ id: 'e1', claimedAt: 1000, dropName: 'Duplicate' });
    await appendClaimLogEntries([e1dup]);
    const loaded = await loadClaimLog();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.dropName).toBe('Original');
  });

  test('FIFO trim keeps only newest by claimedAt when over maxEntries', async () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      makeEntry({ id: `e${i}`, claimedAt: i * 100 }),
    );
    await appendClaimLogEntries(entries, 5);
    const loaded = await loadClaimLog();
    expect(loaded).toHaveLength(5);
    const ids = loaded.map((e) => e.id).sort();
    expect(ids).toEqual(['e2', 'e3', 'e4', 'e5', 'e6']);
  });

  test('clearClaimLog removes the key', async () => {
    await appendClaimLogEntries([makeEntry()]);
    await clearClaimLog();
    const loaded = await loadClaimLog();
    expect(loaded).toEqual([]);
  });

  test('clear after append resolves to empty (write serialization)', async () => {
    const entries = [makeEntry({ id: 'e1' }), makeEntry({ id: 'e2' })];
    const appendPromise = appendClaimLogEntries(entries);
    const clearPromise = clearClaimLog();
    await Promise.all([appendPromise, clearPromise]);
    const loaded = await loadClaimLog();
    expect(loaded).toEqual([]);
  });

  test('same stable id from two paths does not duplicate entry', async () => {
    // Simulates auto-claim path then evaluateDropTransitions detecting same drop
    const drop = makeDrop({ id: 'drop-x', campaignId: 'camp-x' });
    const games: TwitchGame[] = [];
    const entryFromAutoClaim = createClaimLogEntry(drop, games, 1000);
    const entryFromTransition = createClaimLogEntry(drop, games, 2000);
    expect(entryFromAutoClaim.id).toBe(entryFromTransition.id);
    await appendClaimLogEntries([entryFromAutoClaim]);
    await appendClaimLogEntries([entryFromTransition]);
    const loaded = await loadClaimLog();
    expect(loaded).toHaveLength(1);
    // first write wins
    expect(loaded[0]?.claimedAt).toBe(1000);
  });

  test('appendClaimLogEntries returns the number of entries actually added', async () => {
    const e1 = makeEntry({ id: 'e1' });
    const e2 = makeEntry({ id: 'e2' });
    expect(await appendClaimLogEntries([e1, e2])).toEqual({ added: 2, entries: [e1, e2] });
    const e3 = makeEntry({ id: 'e3' });
    expect(await appendClaimLogEntries([e1, e3])).toEqual({ added: 1, entries: [e3] });
    expect(await appendClaimLogEntries([e1])).toEqual({ added: 0, entries: [] });
  });

  test('recordClaimedDrops increments counter by exactly entries added', async () => {
    const target = {
      appState: { totalDropsClaimed: 5, availableGames: [makeGame()] },
    };
    const dropA = makeDrop({ id: 'd1', campaignId: 'camp-1' });
    const dropB = makeDrop({ id: 'd1', campaignId: 'camp-2' });
    await recordClaimedDrops(target, [dropA, dropB]);
    expect(target.appState.totalDropsClaimed).toBe(7);
    expect(await loadClaimLog()).toHaveLength(2);
    await recordClaimedDrops(target, [dropA, dropB]);
    expect(target.appState.totalDropsClaimed).toBe(7);
    expect(await loadClaimLog()).toHaveLength(2);
  });

  test('recordClaimedDrops invokes the registered claim handler for new entries', async () => {
    const recorded: string[] = [];
    setClaimRecordedHandler(async (entries) => {
      recorded.push(...entries.map((entry) => entry.id));
    });
    const target = {
      appState: { totalDropsClaimed: 0, availableGames: [makeGame()] },
    };
    const drop = makeDrop({ id: 'd-handler', campaignId: 'camp-handler' });
    await recordClaimedDrops(target, [drop]);
    expect(recorded).toEqual(['d-handler::camp-handler']);
    setClaimRecordedHandler(null);
  });
});

describe('detectNewlyClaimedDrops', () => {
  test('detects unclaimed→claimed transition', () => {
    const before = [makeDrop({ id: 'd1', campaignId: 'camp-1', claimed: false })];
    const after = [makeDrop({ id: 'd1', campaignId: 'camp-1', claimed: true })];
    const result = detectNewlyClaimedDrops(after, before);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('d1');
  });

  test('distinguishes duplicate drop ids across two campaigns', () => {
    const before = [
      makeDrop({ id: 'd1', campaignId: 'camp-1', claimed: true }),
      makeDrop({ id: 'd1', campaignId: 'camp-2', claimed: false }),
    ];
    const after = [
      makeDrop({ id: 'd1', campaignId: 'camp-1', claimed: true }),
      makeDrop({ id: 'd1', campaignId: 'camp-2', claimed: true }),
    ];
    const result = detectNewlyClaimedDrops(after, before);
    expect(result).toHaveLength(1);
    expect(result[0]?.campaignId).toBe('camp-2');
  });

  test('no backfill for drops arriving already claimed', () => {
    const before: TwitchDrop[] = [];
    const after = [makeDrop({ id: 'd1', campaignId: 'camp-1', claimed: true })];
    expect(detectNewlyClaimedDrops(after, before)).toHaveLength(0);
  });

  test('ignores already-claimed and still-unclaimed', () => {
    const before = [
      makeDrop({ id: 'd1', campaignId: 'camp-1', claimed: true }),
      makeDrop({ id: 'd2', campaignId: 'camp-1', claimed: false }),
    ];
    expect(detectNewlyClaimedDrops(before, before)).toHaveLength(0);
  });
});
