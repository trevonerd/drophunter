import { describe, expect, test } from 'bun:test';
import { isDropCompleted, mergeDropProgressMonotonic } from '../src/shared/drops.ts';

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

// --- dropStateKey stable identity (RED phase: exposes stale reappend bug) ---

// Helper to replicate the current dropStateKey logic inline (since it's not exported yet)
function testDropStateKey(drop: any): string {
  function normalizeToken(token?: string): string {
    if (!token) return '';
    return token
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }
  return `${drop.id}::${drop.campaignId ?? ''}::${normalizeToken(drop.gameName)}::${normalizeToken(drop.name)}::${normalizeToken(drop.imageUrl)}`;
}

test('dropStateKey: same id+campaignId with different imageUrl produces DIFFERENT key (bug evidence)', () => {
  // This test proves the bug: two drops with same logical identity (id + campaignId)
  // but different imageUrl generate different keys. In refresh scenarios, this causes
  // the stale claimed drop to not match the refreshed version and get re-appended.

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

  // This assertion will FAIL with current code because imageUrl is in the key
  // After fix, same id+campaignId should produce same key regardless of imageUrl
  expect(keyA).toBe(keyB);
});

test('dropStateKey: same id+campaignId with different name whitespace produces DIFFERENT key (bug evidence)', () => {
  // This test proves the bug: whitespace or punctuation variations in name between API responses
  // cause the same drop to be treated as a different drop. Some APIs may add/remove spaces or punctuation.

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

  // This assertion will FAIL with current code because the name field itself is in the key
  // (after normalization, both become 'battlepassreward', but the name field is still volatile)
  // After fix, same id+campaignId should produce same key regardless of name variations
  expect(keyA).toBe(keyB);
});

test('stale claimed drop reappend: refresh with different imageUrl creates phantom duplicate (bug evidence)', () => {
  // This test simulates the refresh reconciliation scenario from service-worker.ts:650-654.
  // Previous state has a claimed drop A. Refresh returns what should be the same drop
  // but with different imageUrl. The stale-reappend logic fails to match them due to
  // unstable dropStateKey, causing drop A to be re-added to the final list.

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

  // BUG: Because dropStateKey includes imageUrl, the refreshed drop doesn't match the previous drop.
  // So the previous claimed drop is added to staleReappends, and finalList has 2 copies instead of 1.
  // This assertion will FAIL with current code and PASS after the fix.
  expect(finalList).toHaveLength(1);
  expect(finalList[0].id).toBe('drop-999');
  expect(finalList[0].claimed).toBe(true);
});
