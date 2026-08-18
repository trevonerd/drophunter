import { expect, test } from 'bun:test';
import { isDropCompleted, mergeDropProgressMonotonic } from '../src/shared/drops.ts';
import type { TwitchDrop } from '../src/types';
import { createTwitchDrop } from './fixtures/twitch-drop';

const createDrop = createTwitchDrop;

// --- mergeDropProgressMonotonic ---

test('merge keeps higher progress', () => {
  const next = createDrop({ progress: 30 });
  const prev = createDrop({ progress: 50 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.progress).toBe(50);
});

test('merge sets progress to 100 when claimed', () => {
  const next = createDrop({ progress: 60, claimed: true });
  const prev = createDrop({ progress: 40 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.progress).toBe(100);
  expect(merged.claimed).toBe(true);
});

test('merge propagates claimed from previous', () => {
  const next = createDrop({ claimed: false });
  const prev = createDrop({ claimed: true });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.claimed).toBe(true);
});

test('merge sets claimable to false when claimed', () => {
  const next = createDrop({ claimed: true, claimable: true });
  const prev = createDrop();
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.claimable).toBe(false);
});

test('merge preserves claimable when not claimed', () => {
  const next = createDrop({ claimable: true });
  const prev = createDrop();
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.claimable).toBe(true);
});

test('merge sets progress to 100 when claimable', () => {
  const next = createDrop({ progress: 80, claimable: true });
  const prev = createDrop({ progress: 50 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.progress).toBe(100);
});

test('merge status is completed when claimed', () => {
  const next = createDrop({ claimed: true });
  const prev = createDrop();
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.status).toBe('completed');
});

test('merge status is active when claimable (not completed)', () => {
  const next = createDrop({ claimable: true, claimed: false });
  const prev = createDrop();
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.status).toBe('active');
});

test('merge status is active when progress > 0', () => {
  const next = createDrop({ progress: 25 });
  const prev = createDrop({ progress: 10 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.status).toBe('active');
});

test('merge status is completed when progress is 100 and not claimable', () => {
  const next = createDrop({ progress: 100, claimable: false, claimed: false });
  const prev = createDrop({ progress: 90, claimable: false, claimed: false });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.status).toBe('completed');
});

test('merge status is pending when no progress', () => {
  const next = createDrop({ progress: 0 });
  const prev = createDrop({ progress: 0 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.status).toBe('pending');
});

test('merge takes minimum remainingMinutes', () => {
  const next = createDrop({ remainingMinutes: 30 });
  const prev = createDrop({ remainingMinutes: 20 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.remainingMinutes).toBe(20);
});

test('merge sets remainingMinutes to 0 when claimed', () => {
  const next = createDrop({ claimed: true, remainingMinutes: 10 });
  const prev = createDrop({ remainingMinutes: 20 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.remainingMinutes).toBe(0);
});

test('merge falls back to previous imageUrl', () => {
  const next = createDrop({ imageUrl: '' });
  const prev = createDrop({ imageUrl: 'https://img.twitch.tv/reward.png' });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.imageUrl).toBe('https://img.twitch.tv/reward.png');
});

test('merge falls back to previous campaignId', () => {
  const next = createDrop({ campaignId: '' });
  const prev = createDrop({ campaignId: 'campaign-abc' });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.campaignId).toBe('campaign-abc');
});

test('merge falls back to previous requiredMinutes', () => {
  const next = createDrop({ requiredMinutes: undefined });
  const prev = createDrop({ requiredMinutes: 120 });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.requiredMinutes).toBe(120);
});

test('merge preserves progressSource from next', () => {
  const next = createDrop({ progressSource: 'campaign' });
  const prev = createDrop({ progressSource: 'inventory' });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.progressSource).toBe('campaign');
});

test('merge falls back to previous progressSource', () => {
  const next = createDrop({});
  const prev = createDrop({ progressSource: 'inventory' });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.progressSource).toBe('inventory');
});

// --- isDropCompleted ---

test('isDropCompleted returns true when claimed', () => {
  expect(isDropCompleted(createDrop({ claimed: true }))).toBe(true);
});

test('isDropCompleted returns true when progress 100 and not claimable', () => {
  expect(isDropCompleted(createDrop({ progress: 100, claimable: false }))).toBe(true);
});

test('isDropCompleted returns false when progress 100 but claimable', () => {
  expect(isDropCompleted(createDrop({ progress: 100, claimable: true }))).toBe(false);
});

test('isDropCompleted returns false when progress < 100', () => {
  expect(isDropCompleted(createDrop({ progress: 50 }))).toBe(false);
});

test('merge claimable=true in prev but claimed=true in next → merged is claimed=true, claimable=false', () => {
  const next = createDrop({ claimed: true, claimable: false });
  const prev = createDrop({ claimed: false, claimable: true });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.claimed).toBe(true);
  expect(merged.claimable).toBe(false);
});

test('merge both drops have requiredMinutes: null → merged requiredMinutes stays null', () => {
  const next = createDrop({ requiredMinutes: null });
  const prev = createDrop({ requiredMinutes: null });
  const merged = mergeDropProgressMonotonic(next, prev);
  expect(merged.requiredMinutes).toBeNull();
});

// --- dropStateKey stable identity ---

// Helper to replicate the stable dropStateKey logic inline (since it's not exported yet)
function testDropStateKey(drop: TwitchDrop): string {
  return `${drop.id}::${drop.campaignId ?? ''}`;
}

test('dropStateKey: same id+campaignId stays stable when imageUrl changes', () => {
  // Two drops with the same logical identity should not diverge when Twitch changes CDN URLs.

  const dropA = createDrop({
    id: 'drop-123',
    campaignId: 'campaign-abc',
    name: 'Reward',
    imageUrl: 'https://cdn1.twitch.tv/image.png',
  });

  const dropB = createDrop({
    id: 'drop-123',
    campaignId: 'campaign-abc',
    name: 'Reward',
    imageUrl: 'https://cdn2.twitch.tv/image.png',
  });

  const keyA = testDropStateKey(dropA);
  const keyB = testDropStateKey(dropB);

  expect(keyA).toBe(keyB);
});

test('dropStateKey: same id+campaignId stays stable when display name changes', () => {
  // Whitespace or punctuation variations in names should not create a new drop identity.

  const dropA = createDrop({
    id: 'drop-456',
    campaignId: 'campaign-xyz',
    name: 'Battle-Pass Reward',
    imageUrl: 'https://cdn.twitch.tv/reward.png',
  });

  const dropB = createDrop({
    id: 'drop-456',
    campaignId: 'campaign-xyz',
    name: 'Battle Pass Reward',
    imageUrl: 'https://cdn.twitch.tv/reward.png',
  });

  const keyA = testDropStateKey(dropA);
  const keyB = testDropStateKey(dropB);

  expect(keyA).toBe(keyB);
});

test('stale claimed drop reappend: refresh with different imageUrl does not create a phantom duplicate', () => {
  // This test simulates the refresh reconciliation scenario from service-worker.ts:650-654.
  // Previous state has a claimed drop A. Refresh returns what should be the same drop
  // but with different imageUrl. Stable keys should merge them instead of re-adding
  // the previous claimed copy.

  const previousAllDrops = [
    createDrop({
      id: 'drop-999',
      campaignId: 'campaign-main',
      name: 'Exclusive Reward',
      imageUrl: 'https://cdn-old.twitch.tv/image.png',
      progress: 100,
      claimed: true,
    }),
  ];

  const refreshedAllDrops = [
    createDrop({
      id: 'drop-999',
      campaignId: 'campaign-main',
      name: 'Exclusive Reward',
      imageUrl: 'https://cdn-new.twitch.tv/image.png',
      progress: 100,
      claimed: false,
    }),
  ];

  // Simulate the merge logic from splitDropsForSelectedGame (lines 643-654):
  // const mergedRelevant = relevant.map(...) → would be refreshedAllDrops in this test
  // const previousRelevant = appState.allDrops → would be previousAllDrops

  const previousByKey = new Map(previousAllDrops.map((drop) => [testDropStateKey(drop), drop]));
  const mergedRelevant = refreshedAllDrops.map((drop) => {
    const previous = previousByKey.get(testDropStateKey(drop));
    return previous ? { ...drop, progress: previous.progress, claimed: previous.claimed } : drop;
  });

  const mergedKeys = new Set(mergedRelevant.map((drop) => testDropStateKey(drop)));
  const staleReappends = previousAllDrops
    .filter((drop) => !mergedKeys.has(testDropStateKey(drop)))
    .filter((drop) => drop.claimed);

  const finalList = [...mergedRelevant, ...staleReappends];

  expect(finalList).toHaveLength(1);
  expect(finalList[0].id).toBe('drop-999');
  expect(finalList[0].claimed).toBe(true);
});
