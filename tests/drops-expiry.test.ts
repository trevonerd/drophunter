import { describe, expect, test } from 'bun:test';
import { haveAllDropsExpiredOrVanished, isDropCompleted } from '../src/shared/drops.ts';

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

// --- haveAllDropsExpiredOrVanished ---

test('haveAllDropsExpiredOrVanished([], 3) → true (drops vanished from API, previously had 3)', () => {
  expect(haveAllDropsExpiredOrVanished([], 3)).toBe(true);
});

test('haveAllDropsExpiredOrVanished([], 0) → false (never had drops — first load, do NOT advance queue)', () => {
  expect(haveAllDropsExpiredOrVanished([], 0)).toBe(false);
});

test('haveAllDropsExpiredOrVanished([expiredDrop], 1) → true (one drop with endsAt in past)', () => {
  const expiredDrop = createDrop({
    endsAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  });
  expect(haveAllDropsExpiredOrVanished([expiredDrop], 1)).toBe(true);
});

test('haveAllDropsExpiredOrVanished([expiredDrop, activeDrop], 2) → false (multi-campaign: partial expiry, still has active drop — do NOT skip)', () => {
  const expiredDrop = createDrop({
    endsAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  });
  const activeDrop = createDrop({
    endsAt: new Date(Date.now() + 86400000).toISOString(), // 24 hours from now
  });
  expect(haveAllDropsExpiredOrVanished([expiredDrop, activeDrop], 2)).toBe(false);
});

test('haveAllDropsExpiredOrVanished([claimedDrop], 1) → false (completed drop is NOT expired — it\'s done)', () => {
  const claimedDrop = createDrop({
    claimed: true,
    endsAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  });
  expect(haveAllDropsExpiredOrVanished([claimedDrop], 1)).toBe(false);
});

test('haveAllDropsExpiredOrVanished([dropWithNullEndsAt], 1) → false (no endsAt = cannot confirm expired)', () => {
  const dropWithNullEndsAt = createDrop({
    endsAt: null,
  });
  expect(haveAllDropsExpiredOrVanished([dropWithNullEndsAt], 1)).toBe(false);
});

test('haveAllDropsExpiredOrVanished([dropWithInvalidEndsAt], 1) → false (invalid date string = cannot confirm expired)', () => {
  const dropWithInvalidEndsAt = createDrop({
    endsAt: 'not-a-valid-date',
  });
  expect(haveAllDropsExpiredOrVanished([dropWithInvalidEndsAt], 1)).toBe(false);
});
