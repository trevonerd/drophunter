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
