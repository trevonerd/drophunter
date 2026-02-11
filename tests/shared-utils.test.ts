import { describe, expect, test } from 'bun:test';
import { createInitialState, isExpiredGame, toSlug } from '../src/shared/utils.ts';

// --- toSlug ---

test('toSlug lowercases and slugifies', () => {
  expect(toSlug('Hello World')).toBe('hello-world');
});

test('toSlug replaces multiple non-alnum chars with single dash', () => {
  expect(toSlug('  Foo---Bar  ')).toBe('foo-bar');
});

test('toSlug strips leading/trailing dashes', () => {
  expect(toSlug('---test---')).toBe('test');
});

test('toSlug handles special characters', () => {
  expect(toSlug("Tom Clancy's Rainbow Six")).toBe('tom-clancy-s-rainbow-six');
});

test('toSlug returns empty string for empty input', () => {
  expect(toSlug('')).toBe('');
});

// --- isExpiredGame ---

test('isExpiredGame returns true when expiresInMs is 0', () => {
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', expiresInMs: 0 })).toBe(true);
});

test('isExpiredGame returns true when expiresInMs is negative', () => {
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', expiresInMs: -1000 })).toBe(true);
});

test('isExpiredGame returns false when expiresInMs is positive', () => {
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', expiresInMs: 60000 })).toBe(false);
});

test('isExpiredGame returns true when endsAt is in the past', () => {
  const pastDate = new Date(Date.now() - 60_000).toISOString();
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', endsAt: pastDate })).toBe(true);
});

test('isExpiredGame returns false when endsAt is in the future', () => {
  const futureDate = new Date(Date.now() + 60_000).toISOString();
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', endsAt: futureDate })).toBe(false);
});

test('isExpiredGame returns false when no expiry info', () => {
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '' })).toBe(false);
});

test('isExpiredGame prefers expiresInMs over endsAt', () => {
  const futureDate = new Date(Date.now() + 60_000).toISOString();
  // expiresInMs=0 means expired, even though endsAt is in the future
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', expiresInMs: 0, endsAt: futureDate })).toBe(true);
});

test('isExpiredGame handles null expiresInMs gracefully', () => {
  expect(isExpiredGame({ id: '1', name: 'G', imageUrl: '', expiresInMs: null })).toBe(false);
});

// --- createInitialState ---

test('createInitialState returns fresh state object', () => {
  const state = createInitialState();
  expect(state.isRunning).toBe(false);
  expect(state.isPaused).toBe(false);
  expect(state.selectedGame).toBe(null);
  expect(state.activeStreamer).toBe(null);
  expect(state.currentDrop).toBe(null);
  expect(state.completedDrops).toEqual([]);
  expect(state.pendingDrops).toEqual([]);
  expect(state.allDrops).toEqual([]);
  expect(state.availableGames).toEqual([]);
  expect(state.queue).toEqual([]);
  expect(state.completionNotified).toBe(false);
});

test('createInitialState returns independent instances', () => {
  const a = createInitialState();
  const b = createInitialState();
  a.queue.push({ id: '1', name: 'G', imageUrl: '' });
  expect(b.queue.length).toBe(0);
});
