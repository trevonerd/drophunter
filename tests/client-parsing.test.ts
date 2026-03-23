import { describe, expect, test } from 'bun:test';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedIdCounts,
  computeExpiry,
  extractBroadcasterLanguage,
  extractBenefitIds,
  extractBenefitNames,
  matchClaimedReward,
  normalizeImageUrl,
  normalizeStreamerLanguage,
  normalizeText,
  toIsoDate,
  toNumber,
} from '../src/background/twitch-api/client.ts';
import type { ClaimedRewardEntry } from '../src/background/twitch-api/client.ts';

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

describe('normalizeText', () => {
  test('returns empty string for null', () => {
    expect(normalizeText(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(normalizeText(undefined)).toBe('');
  });

  test('returns empty string for number', () => {
    expect(normalizeText(42)).toBe('');
  });

  test('returns empty string for object', () => {
    expect(normalizeText({})).toBe('');
  });

  test('trims leading and trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  test('preserves inner content', () => {
    expect(normalizeText('Drop Reward')).toBe('Drop Reward');
  });

  test('returns empty string for empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  test('returns empty string for whitespace-only string', () => {
    expect(normalizeText('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// toNumber
// ---------------------------------------------------------------------------

describe('toNumber', () => {
  test('returns integer as-is', () => {
    expect(toNumber(42)).toBe(42);
  });

  test('returns float as-is', () => {
    expect(toNumber(3.14)).toBe(3.14);
  });

  test('parses valid float string', () => {
    expect(toNumber('120')).toBe(120);
  });

  test('parses float string with decimals', () => {
    expect(toNumber('3.5')).toBe(3.5);
  });

  test('returns null for NaN', () => {
    expect(toNumber(NaN)).toBeNull();
  });

  test('returns null for Infinity', () => {
    expect(toNumber(Infinity)).toBeNull();
  });

  test('returns null for -Infinity', () => {
    expect(toNumber(-Infinity)).toBeNull();
  });

  test('returns null for null', () => {
    expect(toNumber(null)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(toNumber('')).toBeNull();
  });

  test('returns null for non-numeric string', () => {
    expect(toNumber('abc')).toBeNull();
  });

  test('returns null for object', () => {
    expect(toNumber({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toIsoDate
// ---------------------------------------------------------------------------

describe('toIsoDate', () => {
  test('returns ISO string for valid date string', () => {
    const result = toIsoDate('2025-06-15T12:00:00Z');
    expect(result).not.toBeNull();
    expect(new Date(result!).getFullYear()).toBe(2025);
  });

  test('returns ISO string format ending in Z', () => {
    const result = toIsoDate('2025-06-15T12:00:00Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('returns null for invalid date string', () => {
    expect(toIsoDate('not-a-date')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(toIsoDate('')).toBeNull();
  });

  test('returns null for whitespace-only string', () => {
    expect(toIsoDate('   ')).toBeNull();
  });

  test('returns null for null', () => {
    expect(toIsoDate(null)).toBeNull();
  });

  test('returns null for number', () => {
    expect(toIsoDate(42)).toBeNull();
  });

  test('returns null for object', () => {
    expect(toIsoDate({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeImageUrl
// ---------------------------------------------------------------------------

describe('normalizeImageUrl', () => {
  test('replaces {width} template with 285', () => {
    const result = normalizeImageUrl('https://img.twitch.tv/box/{width}x{height}.jpg');
    expect(result).toBe('https://img.twitch.tv/box/285x380.jpg');
  });

  test('replaces {width} only', () => {
    expect(normalizeImageUrl('https://example.com/{width}.jpg')).toBe('https://example.com/285.jpg');
  });

  test('replaces {height} only', () => {
    expect(normalizeImageUrl('https://example.com/{height}.jpg')).toBe('https://example.com/380.jpg');
  });

  test('returns plain URL as-is', () => {
    const url = 'https://img.twitch.tv/box/static.jpg';
    expect(normalizeImageUrl(url)).toBe(url);
  });

  test('returns empty string for empty input', () => {
    expect(normalizeImageUrl('')).toBe('');
  });

  test('returns empty string for null', () => {
    expect(normalizeImageUrl(null)).toBe('');
  });

  test('returns empty string for non-string', () => {
    expect(normalizeImageUrl(123)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// normalizeStreamerLanguage / extractBroadcasterLanguage
// ---------------------------------------------------------------------------

describe('normalizeStreamerLanguage', () => {
  test('normalizes locale strings to the primary language token', () => {
    expect(normalizeStreamerLanguage('EN-gb')).toBe('en');
    expect(normalizeStreamerLanguage('pt_BR')).toBe('pt');
  });

  test('returns undefined for invalid or empty values', () => {
    expect(normalizeStreamerLanguage('')).toBeUndefined();
    expect(normalizeStreamerLanguage('english')).toBeUndefined();
    expect(normalizeStreamerLanguage(null)).toBeUndefined();
  });
});

describe('extractBroadcasterLanguage', () => {
  test('extracts language from broadcaster settings when present', () => {
    expect(
      extractBroadcasterLanguage({
        broadcaster: {
          broadcastSettings: {
            language: 'IT-it',
          },
        },
      }),
    ).toBe('it');
  });

  test('extracts language from top-level fallback fields when present', () => {
    expect(
      extractBroadcasterLanguage({
        broadcasterLanguage: 'EN_us',
      }),
    ).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// computeExpiry
// ---------------------------------------------------------------------------

describe('computeExpiry', () => {
  test('returns unknown status for null endsAt', () => {
    const result = computeExpiry(null);
    expect(result.expiresInMs).toBeNull();
    expect(result.expiryStatus).toBe('unknown');
  });

  test('returns unknown status for invalid date string', () => {
    const result = computeExpiry('not-a-date');
    expect(result.expiresInMs).toBeNull();
    expect(result.expiryStatus).toBe('unknown');
  });

  test('returns safe for expiry > 72h in the future', () => {
    const future = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
    const result = computeExpiry(future);
    expect(result.expiryStatus).toBe('safe');
    expect(result.expiresInMs).toBeGreaterThan(0);
  });

  test('returns warning for expiry between 24h and 72h', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const result = computeExpiry(future);
    expect(result.expiryStatus).toBe('warning');
    expect(result.expiresInMs).toBeGreaterThan(0);
  });

  test('returns urgent for expiry <= 24h', () => {
    const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const result = computeExpiry(future);
    expect(result.expiryStatus).toBe('urgent');
  });

  test('returns expiresInMs <= 0 for past date', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = computeExpiry(past);
    expect(result.expiresInMs).not.toBeNull();
    expect(result.expiresInMs!).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// extractBenefitIds / extractBenefitNames
// ---------------------------------------------------------------------------

function makeDrop(benefitEdges: unknown): Record<string, unknown> {
  return { benefitEdges };
}

function makeEdge(id: string, name: string) {
  return { benefit: { id, name } };
}

describe('extractBenefitIds', () => {
  test('returns ids from well-formed benefitEdges', () => {
    const drop = makeDrop([makeEdge('id-1', 'Reward One'), makeEdge('id-2', 'Reward Two')]);
    expect(extractBenefitIds(drop)).toEqual(['id-1', 'id-2']);
  });

  test('filters out edges with missing benefit', () => {
    const drop = makeDrop([{ benefit: null }, makeEdge('id-1', 'Reward')]);
    expect(extractBenefitIds(drop)).toEqual(['id-1']);
  });

  test('filters out edges that are not objects', () => {
    const drop = makeDrop(['string-edge', makeEdge('id-1', 'Reward')]);
    expect(extractBenefitIds(drop)).toEqual(['id-1']);
  });

  test('returns empty array when benefitEdges is not an array', () => {
    expect(extractBenefitIds(makeDrop(null))).toEqual([]);
    expect(extractBenefitIds(makeDrop('string'))).toEqual([]);
    expect(extractBenefitIds(makeDrop(undefined))).toEqual([]);
  });

  test('filters out edges where benefit.id is empty', () => {
    const drop = makeDrop([{ benefit: { id: '', name: 'Reward' } }]);
    expect(extractBenefitIds(drop)).toEqual([]);
  });
});

describe('extractBenefitNames', () => {
  test('returns lowercased names from well-formed benefitEdges', () => {
    const drop = makeDrop([makeEdge('id-1', 'Reward ONE'), makeEdge('id-2', 'BUNDLE')]);
    expect(extractBenefitNames(drop)).toEqual(['reward one', 'bundle']);
  });

  test('filters out edges with missing benefit', () => {
    const drop = makeDrop([{ benefit: null }, makeEdge('id-1', 'Reward')]);
    expect(extractBenefitNames(drop)).toEqual(['reward']);
  });

  test('returns empty array when benefitEdges is not an array', () => {
    expect(extractBenefitNames(makeDrop(null))).toEqual([]);
  });

  test('filters out edges where benefit.name normalizes to empty', () => {
    const drop = makeDrop([{ benefit: { id: 'x', name: '   ' } }]);
    expect(extractBenefitNames(drop)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildGlobalClaimedIdCounts  (v1.6.1 fix coverage)
// ---------------------------------------------------------------------------

function makeInventory(gameEventDrops: unknown[]): unknown {
  return { gameEventDrops };
}

describe('buildGlobalClaimedIdCounts', () => {
  test('returns a Set containing all benefit ids', () => {
    const inv = makeInventory([
      { id: 'benefit-a', name: 'Reward A', game: { displayName: 'GameX' } },
      { id: 'benefit-b', name: 'Reward B', game: { displayName: 'GameX' } },
    ]);
    const result = buildGlobalClaimedIdCounts(inv);
    expect(result).toBeInstanceOf(Set);
    expect(result.has('benefit-a')).toBe(true);
    expect(result.has('benefit-b')).toBe(true);
    expect(result.size).toBe(2);
  });

  test('duplicate ids appear only once in the Set (v1.6.1 fix)', () => {
    const inv = makeInventory([
      { id: 'benefit-a', name: 'Reward A', game: { displayName: 'Game1' } },
      { id: 'benefit-a', name: 'Reward A', game: { displayName: 'Game2' } },
    ]);
    const result = buildGlobalClaimedIdCounts(inv);
    expect(result.size).toBe(1);
    expect(result.has('benefit-a')).toBe(true);
  });

  test('returns empty set for empty inventory', () => {
    expect(buildGlobalClaimedIdCounts(makeInventory([]))).toEqual(new Set());
  });

  test('returns empty set for null input', () => {
    expect(buildGlobalClaimedIdCounts(null)).toEqual(new Set());
  });

  test('returns empty set for non-object input', () => {
    expect(buildGlobalClaimedIdCounts('invalid')).toEqual(new Set());
  });

  test('skips drops without an id', () => {
    const inv = makeInventory([
      { name: 'No ID drop', game: { displayName: 'GameX' } },
      { id: 'benefit-c', name: 'Valid', game: { displayName: 'GameX' } },
    ]);
    const result = buildGlobalClaimedIdCounts(inv);
    expect(result.size).toBe(1);
    expect(result.has('benefit-c')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildClaimedRewardLookup
// ---------------------------------------------------------------------------

describe('buildClaimedRewardLookup', () => {
  test('groups drops by lowercased game name', () => {
    const inv = makeInventory([
      { id: 'id-1', name: 'Reward A', game: { displayName: 'My Game' } },
      { id: 'id-2', name: 'Reward B', game: { displayName: 'My Game' } },
    ]);
    const lookup = buildClaimedRewardLookup(inv);
    expect(lookup.has('my game')).toBe(true);
    const entry = lookup.get('my game')!;
    expect(entry.idCounts.get('id-1')).toBe(1);
    expect(entry.idCounts.get('id-2')).toBe(1);
    expect(entry.nameCounts.get('reward a')).toBe(1);
    expect(entry.nameCounts.get('reward b')).toBe(1);
  });

  test('accumulates counts for repeated ids within the same game', () => {
    const inv = makeInventory([
      { id: 'id-1', name: 'Reward', game: { displayName: 'Game' } },
      { id: 'id-1', name: 'Reward', game: { displayName: 'Game' } },
    ]);
    const entry = buildClaimedRewardLookup(inv).get('game')!;
    expect(entry.idCounts.get('id-1')).toBe(2);
    expect(entry.nameCounts.get('reward')).toBe(2);
  });

  test('uses game.name as fallback when displayName is absent', () => {
    const inv = makeInventory([{ id: 'id-1', name: 'Drop', game: { name: 'FallbackGame' } }]);
    const lookup = buildClaimedRewardLookup(inv);
    expect(lookup.has('fallbackgame')).toBe(true);
  });

  test('returns empty map for empty inventory', () => {
    expect(buildClaimedRewardLookup(makeInventory([]))).toEqual(new Map());
  });

  test('returns empty map for null input', () => {
    expect(buildClaimedRewardLookup(null)).toEqual(new Map());
  });

  test('skips drops without a game object', () => {
    const inv = makeInventory([{ id: 'id-1', name: 'Drop' }]);
    expect(buildClaimedRewardLookup(inv).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// matchClaimedReward  (most critical — covers all 3 layers)
// ---------------------------------------------------------------------------

function makeEntry(ids: Record<string, number>, names: Record<string, number>): ClaimedRewardEntry {
  return {
    idCounts: new Map(Object.entries(ids)),
    nameCounts: new Map(Object.entries(names)),
  };
}

describe('matchClaimedReward', () => {
  test('Layer 1: returns idMatch=true when benefit id is found in game entry', () => {
    const entry = makeEntry({ 'benefit-1': 1 }, {});
    const result = matchClaimedReward(['benefit-1'], ['reward'], entry, new Set());
    expect(result.idMatch).toBe(true);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });

  test('Layer 1: decrements idCount after a match', () => {
    const entry = makeEntry({ 'benefit-1': 2 }, {});
    matchClaimedReward(['benefit-1'], [], entry, new Set());
    expect(entry.idCounts.get('benefit-1')).toBe(1);
  });

  test('Layer 1: does not match when idCount is 0', () => {
    const entry = makeEntry({ 'benefit-1': 0 }, { reward: 1 });
    const result = matchClaimedReward(['benefit-1'], ['reward'], entry, new Set());
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(true);
  });

  test('Layer 2: returns nameMatch=true when id not found but name is found', () => {
    const entry = makeEntry({}, { 'gold chest': 1 });
    const result = matchClaimedReward(['unknown-id'], ['gold chest'], entry, new Set());
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(true);
    expect(result.globalIdMatch).toBe(false);
  });

  test('Layer 2: decrements nameCount after a match', () => {
    const entry = makeEntry({}, { reward: 3 });
    matchClaimedReward([], ['reward'], entry, new Set());
    expect(entry.nameCounts.get('reward')).toBe(2);
  });

  test('Layer 3: returns globalIdMatch=true when gameClaimedRewards is undefined and id is in global set', () => {
    const globalSet = new Set(['benefit-global']);
    const result = matchClaimedReward(['benefit-global'], ['reward'], undefined, globalSet);
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(true);
  });

  test('Layer 3: multiple drops with same id ALL get globalIdMatch=true (v1.6.1 fix)', () => {
    const globalSet = new Set(['benefit-shared']);
    const r1 = matchClaimedReward(['benefit-shared'], ['drop 1'], undefined, globalSet);
    const r2 = matchClaimedReward(['benefit-shared'], ['drop 2'], undefined, globalSet);
    expect(r1.globalIdMatch).toBe(true);
    expect(r2.globalIdMatch).toBe(true);
  });

  test('Layer 3: does NOT fire when gameClaimedRewards is defined (even if empty)', () => {
    const globalSet = new Set(['benefit-global']);
    const entry = makeEntry({}, {});
    const result = matchClaimedReward(['benefit-global'], [], entry, globalSet);
    expect(result.globalIdMatch).toBe(false);
  });

  test('no match when all lookups miss', () => {
    const entry = makeEntry({ 'other-id': 1 }, { 'other-name': 1 });
    const result = matchClaimedReward(['benefit-x'], ['reward-x'], entry, new Set());
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });

  test('no match with empty benefit lists', () => {
    const result = matchClaimedReward([], [], undefined, new Set(['benefit-a']));
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });
});
