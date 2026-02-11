import { describe, expect, test } from 'bun:test';
import { normalizeToken, scoreDropMatch, tokenOverlapScore } from '../src/shared/matching.ts';

function createDrop(overrides = {}) {
  return {
    id: `drop-${Math.random().toString(36).slice(2)}`,
    name: 'Reward',
    gameId: 'game-1',
    gameName: 'Game',
    imageUrl: '',
    progress: 0,
    claimed: false,
    ...overrides,
  };
}

// --- normalizeToken ---

test('normalizeToken lowercases', () => {
  expect(normalizeToken('Hello World')).toBe('hello world');
});

test('normalizeToken replaces special chars with spaces', () => {
  expect(normalizeToken("Tom Clancy's: Rainbow Six")).toBe('tom clancy s rainbow six');
});

test('normalizeToken trims', () => {
  expect(normalizeToken('  test  ')).toBe('test');
});

test('normalizeToken collapses multiple separators', () => {
  expect(normalizeToken('foo---bar___baz')).toBe('foo bar baz');
});

test('normalizeToken handles empty string', () => {
  expect(normalizeToken('')).toBe('');
});

test('normalizeToken preserves numbers', () => {
  expect(normalizeToken('Counter-Strike 2')).toBe('counter strike 2');
});

// --- tokenOverlapScore ---

test('tokenOverlapScore returns 1 for identical strings', () => {
  expect(tokenOverlapScore('World of Warcraft', 'World of Warcraft')).toBe(1);
});

test('tokenOverlapScore returns 0 for completely different strings', () => {
  expect(tokenOverlapScore('Minecraft', 'Fortnite')).toBe(0);
});

test('tokenOverlapScore ignores tokens shorter than 3 chars', () => {
  // "of" is < 3 chars, so only "world" and "warcraft" count
  const score = tokenOverlapScore('World of Warcraft', 'World of Tanks');
  // overlap: "world" (1 of max 2 tokens on each side)
  expect(score).toBe(0.5);
});

test('tokenOverlapScore returns 0 when one side has no qualifying tokens', () => {
  expect(tokenOverlapScore('AB', 'CD')).toBe(0);
});

test('tokenOverlapScore handles partial overlap', () => {
  // "call", "duty", "modern", "warfare" vs "call", "duty", "black", "ops"
  // overlap: "call", "duty" = 2, max size = 4
  const score = tokenOverlapScore('Call of Duty: Modern Warfare', 'Call of Duty: Black Ops');
  expect(score).toBe(0.5);
});

// --- scoreDropMatch ---

test('scoreDropMatch returns 1000 for exact ID match', () => {
  const a = createDrop({ id: 'drop-123' });
  const b = createDrop({ id: 'drop-123' });
  expect(scoreDropMatch(a, b)).toBe(1000);
});

test('scoreDropMatch scores name match', () => {
  const a = createDrop({ name: 'Gold Chest' });
  const b = createDrop({ name: 'Gold Chest' });
  const score = scoreDropMatch(a, b);
  expect(score).toBeGreaterThanOrEqual(40);
});

test('scoreDropMatch scores partial name match', () => {
  const a = createDrop({ name: 'Gold Chest' });
  const b = createDrop({ name: 'Gold Chest Deluxe' });
  const score = scoreDropMatch(a, b);
  expect(score).toBeGreaterThanOrEqual(15);
});

test('scoreDropMatch scores same game name', () => {
  const a = createDrop({ gameName: 'Fortnite' });
  const b = createDrop({ gameName: 'Fortnite' });
  const score = scoreDropMatch(a, b);
  expect(score).toBeGreaterThanOrEqual(20);
});

test('scoreDropMatch scores same imageUrl', () => {
  const a = createDrop({ imageUrl: 'https://img.twitch.tv/reward.png' });
  const b = createDrop({ imageUrl: 'https://img.twitch.tv/reward.png' });
  const score = scoreDropMatch(a, b);
  expect(score).toBeGreaterThanOrEqual(40);
});

test('scoreDropMatch scores same campaignId', () => {
  const a = createDrop({ campaignId: 'campaign-abc' });
  const b = createDrop({ campaignId: 'campaign-abc' });
  const score = scoreDropMatch(a, b);
  expect(score).toBeGreaterThanOrEqual(30);
});

test('scoreDropMatch returns 0 for completely different drops', () => {
  const a = createDrop({ id: 'a', name: 'Alpha', gameName: 'X', imageUrl: 'x', campaignId: 'x' });
  const b = createDrop({ id: 'b', name: 'Beta', gameName: 'Y', imageUrl: 'y', campaignId: 'y' });
  expect(scoreDropMatch(a, b)).toBe(0);
});

test('scoreDropMatch accumulates multiple signals', () => {
  const a = createDrop({ name: 'Gold Chest', gameName: 'Fortnite', campaignId: 'c1', imageUrl: 'img1' });
  const b = createDrop({ name: 'Gold Chest', gameName: 'Fortnite', campaignId: 'c1', imageUrl: 'img1' });
  const score = scoreDropMatch(a, b);
  // 40 (name) + 15 (includes) + 20 (game) + 40 (image) + 30 (campaign) = 145
  expect(score).toBe(145);
});
