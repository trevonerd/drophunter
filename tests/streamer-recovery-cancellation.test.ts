import { expect, test } from 'bun:test';
import {
  currentFarmingSessionEpoch,
  invalidateFarmingSessionEpoch,
} from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { handleStalledProgress } from '../src/background/streamer-recovery-handlers.ts';
import { makeDrop } from './fixtures/auto-claim-drops.ts';

test.each([
  'playback',
  'refresh',
] as const)('cancels stalled recovery after pending %s finishes', async (boundary) => {
  const state = createServiceWorkerState();
  state.appState.currentDrop = makeDrop();
  state.stalledRecoveryAttempts = boundary === 'playback' ? 0 : 1;
  const epoch = currentFarmingSessionEpoch(state);
  let enterBoundary: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    enterBoundary = resolve;
  });
  let finishBoundary: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finishBoundary = resolve;
  });
  const effects: string[] = [];
  const pending = handleStalledProgress(
    state,
    { id: 8 },
    {
      isCurrent: () => currentFarmingSessionEpoch(state) === epoch,
      onAttemptPlaybackSelfHeal: async () => {
        enterBoundary();
        await finished;
      },
      onForceRefreshDropsData: async () => {
        enterBoundary();
        await finished;
        return 'refreshed';
      },
      onRotateStreamer: async () => {
        effects.push('rotate');
        return true;
      },
      onSaveState: async () => {
        effects.push('save');
      },
      onSaveTimingState: async () => {
        effects.push('timing');
      },
    },
    Date.now(),
    60_000,
  );
  await entered;
  invalidateFarmingSessionEpoch(state);
  const expectedState = structuredClone(state);
  finishBoundary();
  await pending;
  expect(state).toEqual(expectedState);
  expect(effects).toEqual([]);
});
