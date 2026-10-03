import { expect, test } from 'bun:test';
import { normalizeToken, tokenOverlapScore } from '../src/shared/matching.ts';

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

test('tokenOverlapScore returns 0 when all tokens are shorter than 3 chars', () => {
  // "go", "to", "be" are all < 3 chars, no qualifying tokens on either side
  expect(tokenOverlapScore('go to', 'be do')).toBe(0);
});

test('tokenOverlapScore handles partial overlap', () => {
  // "call", "duty", "modern", "warfare" vs "call", "duty", "black", "ops"
  // overlap: "call", "duty" = 2, max size = 4
  const score = tokenOverlapScore('Call of Duty: Modern Warfare', 'Call of Duty: Black Ops');
  expect(score).toBe(0.5);
});
