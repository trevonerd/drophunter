import { describe, expect, test } from 'bun:test';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedRewardEntry,
  buildGlobalClaimedIdCounts,
  computeExpiry,
  extractBroadcasterLanguage,
  extractBenefitDistributionTypes,
  extractBenefitIds,
  extractBenefitNames,
  matchClaimedReward,
  normalizeImageUrl,
  normalizeStreamerLanguage,
  normalizeText,
  toIsoDate,
  toNumber,
  normalizeLanguageForApi,
} from '../src/background/twitch-api/client.ts';
import { TwitchApiClient } from '../src/background/twitch-api/client.ts';
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

function makeTypedEdge(id: string, name: string, distributionType: string) {
  return { benefit: { id, name, distributionType } };
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

describe('extractBenefitDistributionTypes', () => {
  test('returns normalized distribution types from benefit edges', () => {
    const drop = makeDrop([makeTypedEdge('id-1', 'Badge', 'BADGE'), makeTypedEdge('id-2', 'Emote', 'emote')]);
    expect(extractBenefitDistributionTypes(drop)).toEqual(['BADGE', 'EMOTE']);
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

describe('buildGlobalClaimedRewardEntry', () => {
  test('stores benefit ids and awarded timestamps', () => {
    const inv = makeInventory([
      {
        id: 'benefit-a',
        name: 'Reward A',
        game: { displayName: 'GameX' },
        lastAwardedAt: '2026-05-18T12:00:00Z',
      },
    ]);
    const result = buildGlobalClaimedRewardEntry(inv);
    expect(result.idCounts.get('benefit-a')).toBe(1);
    expect(result.idAwardedAt.get('benefit-a')).toEqual(['2026-05-18T12:00:00.000Z']);
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
    idAwardedAt: new Map(Object.entries(ids).filter(([, count]) => count > 0).map(([id]) => [id, [null]])),
  };
}

const emptyEntry = makeEntry({}, {});
const defaultWindow = { startsAt: null, endsAt: null };

function matchForTest(
  benefitIds: string[],
  benefitNames: string[],
  gameClaimedRewards: ClaimedRewardEntry | undefined,
  globalClaimedRewards: ClaimedRewardEntry = emptyEntry,
  window = defaultWindow,
  allowGlobalIdMatch = true,
) {
  return matchClaimedReward(
    benefitIds,
    benefitNames,
    gameClaimedRewards,
    globalClaimedRewards,
    window,
    allowGlobalIdMatch,
  );
}

describe('matchClaimedReward', () => {
  test('Layer 1: returns idMatch=true when benefit id is found in game entry', () => {
    const entry = makeEntry({ 'benefit-1': 1 }, {});
    const result = matchForTest(['benefit-1'], ['reward'], entry);
    expect(result.idMatch).toBe(true);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });

  test('Layer 1: keeps idCount reusable for duplicate drops with the same benefit id', () => {
    const entry = makeEntry({ 'benefit-1': 1 }, {});
    const first = matchForTest(['benefit-1'], [], entry);
    const second = matchForTest(['benefit-1'], [], entry);
    expect(first.idMatch).toBe(true);
    expect(second.idMatch).toBe(true);
    expect(entry.idCounts.get('benefit-1')).toBe(1);
  });

  test('Layer 1: does not match when idCount is 0', () => {
    const entry = makeEntry({ 'benefit-1': 0 }, { reward: 1 });
    const result = matchForTest(['benefit-1'], ['reward'], entry);
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
  });

  test('Layer 2: does not claim by reward name without a benefit id match', () => {
    const entry = makeEntry({}, { 'gold chest': 1 });
    const result = matchForTest(['unknown-id'], ['gold chest'], entry);
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });

  test('Layer 3: returns globalIdMatch=true when gameClaimedRewards is undefined and id is in global set', () => {
    const globalEntry = makeEntry({ 'benefit-global': 1 }, {});
    const result = matchForTest(['benefit-global'], ['reward'], undefined, globalEntry);
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(true);
  });

  test('Layer 3: multiple drops with same id ALL get globalIdMatch=true (v1.6.1 fix)', () => {
    const globalEntry = makeEntry({ 'benefit-shared': 1 }, {});
    const r1 = matchForTest(['benefit-shared'], ['drop 1'], undefined, globalEntry);
    const r2 = matchForTest(['benefit-shared'], ['drop 2'], undefined, globalEntry);
    expect(r1.globalIdMatch).toBe(true);
    expect(r2.globalIdMatch).toBe(true);
  });

  test('Layer 3: does NOT fire when gameClaimedRewards is defined (even if empty)', () => {
    const globalEntry = makeEntry({ 'benefit-global': 1 }, {});
    const entry = makeEntry({}, {});
    const result = matchForTest(['benefit-global'], [], entry, globalEntry);
    expect(result.globalIdMatch).toBe(false);
  });

  test('no match when all lookups miss', () => {
    const entry = makeEntry({ 'other-id': 1 }, { 'other-name': 1 });
    const result = matchForTest(['benefit-x'], ['reward-x'], entry);
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });

  test('no match with empty benefit lists', () => {
    const globalEntry = makeEntry({ 'benefit-a': 1 }, {});
    const result = matchForTest([], [], undefined, globalEntry);
    expect(result.idMatch).toBe(false);
    expect(result.nameMatch).toBe(false);
    expect(result.globalIdMatch).toBe(false);
  });

  test('matches awarded benefit only inside the drop window when timestamp is present', () => {
    const entry = makeEntry({}, {});
    entry.idCounts.set('benefit-windowed', 1);
    entry.idAwardedAt.set('benefit-windowed', ['2026-05-18T12:00:00.000Z']);

    const inside = matchForTest(['benefit-windowed'], [], entry, emptyEntry, {
      startsAt: '2026-05-18T06:00:00.000Z',
      endsAt: '2026-05-19T06:00:00.000Z',
    });
    const outside = matchForTest(['benefit-windowed'], [], entry, emptyEntry, {
      startsAt: '2026-05-19T06:00:00.000Z',
      endsAt: '2026-05-20T06:00:00.000Z',
    });

    expect(inside.idMatch).toBe(true);
    expect(outside.idMatch).toBe(false);
  });

  test('blocks global benefit fallback when not explicitly allowed', () => {
    const globalEntry = makeEntry({ 'benefit-global': 1 }, {});
    const result = matchForTest(['benefit-global'], [], undefined, globalEntry, defaultWindow, false);
    expect(result.globalIdMatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeLanguageForApi
// ---------------------------------------------------------------------------

describe('normalizeLanguageForApi', () => {
  test('normalizes lowercase language code to uppercase', () => {
    expect(normalizeLanguageForApi('it')).toBe('IT');
  });

  test('normalizes english code to uppercase', () => {
    expect(normalizeLanguageForApi('en')).toBe('EN');
  });

  test('normalizes compound zh_hk code preserving structure', () => {
    expect(normalizeLanguageForApi('zh_hk')).toBe('ZH_HK');
  });

  test('returns empty string for empty input (any/no preference)', () => {
    expect(normalizeLanguageForApi('')).toBe('');
  });
});
