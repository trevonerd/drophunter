import { expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';

test('same-version load removes corrupt drop rows but retains valid progress proof', () => {
  const state = normalizeStoredAppState({
    ...createInitialState(),
    allDrops: [
      null,
      false,
      { id: 'reward', gameId: 'game', progress: 73, currentMinutes: 42, claimed: true },
    ],
    pendingDrops: [null],
    completedDrops: [{ id: 'reward', gameId: 'game', progress: 100, currentMinutes: 60, claimed: true }],
    currentDrop: null,
  });
  expect(state.allDrops).toHaveLength(1);
  expect(state.allDrops[0]).toMatchObject({ id: 'reward', progress: 73, currentMinutes: 42, claimed: true });
  expect(state.pendingDrops).toEqual([]);
  expect(state.completedDrops[0]?.progress).toBe(100);
  expect(state.currentDrop).toBeNull();
});

test('same-version load rejects unknown recovery enums and invalid counters without authorizing farming', () => {
  const state = normalizeStoredAppState({
    ...createInitialState(),
    queue: [{ id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' }],
    isRunning: 'true',
    manualQueueAuthorized: false,
    recoveryReason: 'unrecognized-recovery',
    recoveryBackoffUntil: Date.now() + 365 * 24 * 60 * 60_000,
    recoveryAttempts: -5,
    tabId: -1,
    activeStreamer: { name: null },
  });
  expect(state.isRunning).toBe(false);
  expect(state.manualQueueAuthorized).toBe(false);
  expect(state.recoveryReason).toBeNull();
  expect(state.recoveryBackoffUntil).toBeNull();
  expect(state.recoveryAttempts).toBeNull();
  expect(state.tabId).toBeNull();
  expect(state.activeStreamer).toBeNull();
  expect(state.queue).toHaveLength(1);
});

test('a paused authorized queue remains paused even if its running bit was lost', () => {
  const state = normalizeStoredAppState({
    ...createInitialState(),
    isRunning: false,
    isPaused: true,
    manualQueueAuthorized: true,
    queue: [{ id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' }],
  });
  expect(state.isRunning).toBe(true);
  expect(state.isPaused).toBe(true);
  expect(state.manualQueueAuthorized).toBe(true);
});
