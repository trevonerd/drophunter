import { describe, expect, test } from 'bun:test';
import { invalidateFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { rotateStreamer } from '../src/background/streamer-acquisition.ts';

describe('streamer rotation cancellation', () => {
  for (const action of ['stop', 'restart', 'selection', 'monitor-stop'] as const) {
    test.each([
      'opened',
      'unavailable',
      'rejected',
    ] as const)(`ignores pending %s rotation after ${action}`, async (outcome) => {
      const state = createServiceWorkerState();
      const campaign = { id: 'game-a', campaignId: 'campaign-a', name: 'Game A', imageUrl: '' };
      state.appState.selectedGame = campaign;
      state.appState.isRunning = true;
      let finishOpen: () => void = () => undefined;
      const openReady = new Promise<void>((resolve) => {
        finishOpen = resolve;
      });
      const effects: string[] = [];
      const pending = rotateStreamer(state, 'stalled-progress', {
        onOpenStreamer: async (isCurrent) => {
          expect(isCurrent?.()).toBe(true);
          await openReady;
          expect(isCurrent?.()).toBe(false);
          if (outcome === 'rejected') throw new Error('stream open failed');
          return outcome === 'opened';
        },
        onSkipCurrentGame: async () => {
          effects.push('skip');
        },
        onSaveState: async () => {
          effects.push('save');
        },
        onSaveTimingState: async () => {
          effects.push('timing');
        },
      });

      if (action === 'stop' || action === 'restart') invalidateFarmingSessionEpoch(state);
      if (action === 'monitor-stop') state.tickGeneration += 1;
      state.appState.isRunning = action !== 'stop';
      if (action === 'stop') state.appState.selectedGame = null;
      if (action === 'selection') state.appState.selectedGame = { ...campaign, campaignId: 'campaign-b' };
      const expectedState = structuredClone(state);
      finishOpen();

      expect(await pending).toBe(false);
      expect(state).toEqual(expectedState);
      expect(effects).toEqual([]);
    });
  }

  test('still rejects a current streamer failure without skipping or persisting', async () => {
    const state = createServiceWorkerState();
    const failure = new Error('stream open failed');
    const effects: string[] = [];
    const pending = rotateStreamer(state, 'stalled-progress', {
      onOpenStreamer: async () => {
        throw failure;
      },
      onSkipCurrentGame: async () => {
        effects.push('skip');
      },
      onSaveState: async () => {
        effects.push('save');
      },
    });
    await expect(pending).rejects.toBe(failure);
    expect(effects).toEqual([]);
  });

  test.each(['skip', 'save'] as const)('stops persistence after cancellation during %s', async (boundary) => {
    const state = createServiceWorkerState();
    let enterBoundary: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      enterBoundary = resolve;
    });
    let finishBoundary: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finishBoundary = resolve;
    });
    const effects: string[] = [];
    const pending = rotateStreamer(state, 'stalled-progress', {
      onOpenStreamer: async () => false,
      onSkipCurrentGame: async () => {
        effects.push('skip');
        if (boundary === 'skip') {
          enterBoundary();
          await finished;
        }
      },
      onSaveState: async () => {
        effects.push('save');
        if (boundary === 'save') {
          enterBoundary();
          await finished;
        }
      },
      onSaveTimingState: async () => {
        effects.push('timing');
      },
    });
    await entered;
    invalidateFarmingSessionEpoch(state);
    finishBoundary();
    expect(await pending).toBe(false);
    expect(effects).toEqual(boundary === 'skip' ? ['skip'] : ['skip', 'save']);
  });
});
