import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNearestDrop, sortPendingDrops } from '../src/shared/drop-order.js';

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

test('sortPendingDrops prioritizes lower ETA first', () => {
  const drops = [
    createDrop({ name: 'B', remainingMinutes: 45, expiresInMs: 1000 }),
    createDrop({ name: 'A', remainingMinutes: 10, expiresInMs: 1000 }),
    createDrop({ name: 'C', remainingMinutes: 80, expiresInMs: 1000 }),
  ];

  const ordered = sortPendingDrops(drops);
  assert.equal(ordered[0].name, 'A');
  assert.equal(ordered[1].name, 'B');
  assert.equal(ordered[2].name, 'C');
});

test('sortPendingDrops uses nearest expiry when ETA ties', () => {
  const drops = [
    createDrop({ name: 'Late', remainingMinutes: 10, expiresInMs: 60_000 }),
    createDrop({ name: 'Soon', remainingMinutes: 10, expiresInMs: 30_000 }),
  ];

  const ordered = sortPendingDrops(drops);
  assert.equal(ordered[0].name, 'Soon');
  assert.equal(ordered[1].name, 'Late');
});

test('sortPendingDrops prefers higher progress if ETA and expiry tie', () => {
  const drops = [
    createDrop({ name: 'Low', remainingMinutes: 10, expiresInMs: 30_000, progress: 20 }),
    createDrop({ name: 'High', remainingMinutes: 10, expiresInMs: 30_000, progress: 70 }),
  ];

  const ordered = sortPendingDrops(drops);
  assert.equal(ordered[0].name, 'High');
  assert.equal(ordered[1].name, 'Low');
});

test('pickNearestDrop returns null for empty collections', () => {
  assert.equal(pickNearestDrop([]), null);
});
