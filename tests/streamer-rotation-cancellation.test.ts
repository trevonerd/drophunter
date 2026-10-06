import { describe, expect, test } from 'bun:test';
import { invalidateFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { rotateStreamer } from '../src/background/streamer-acquisition.ts';

describe('streamer rotation cancellation', () => {
  for (const action of ['stop', 'restart', 'selection', 'monitor-stop'] as const) {
    test.each(['opened', 'unavailable', 'rejected'] as const)(
      `ignores pending %s rotation after ${action}`,
      async (outcome) => {
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
      },
    );
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

  test('keeps the working streamer and rotation baseline when a replacement cannot open', async () => {
    const state = createServiceWorkerState();
    state.appState.selectedGame = { id: 'game-a', campaignId: 'campaign-a', name: 'Game A', imageUrl: '' };
    state.appState.isRunning = true;
    state.appState.activeStreamer = {
      id: 'incumbent',
      name: 'incumbent',
      displayName: 'incumbent',
      isLive: true,
    };
    state.lastProgressAdvanceAt = 10_000;
    state.lastStreamRotationAt = 11_000;
    const effects: string[] = [];

    const opened = await rotateStreamer(state, 'stalled-progress', {
      onOpenStreamer: async () => false,
      onSkipCurrentGame: async () => {
        effects.push('skip');
      },
      onSaveState: async () => {
        effects.push('save');
      },
    });

    expect(opened).toBe(false);
    expect(state.appState.activeStreamer?.name).toBe('incumbent');
    expect(state.lastProgressAdvanceAt).toBe(10_000);
    expect(state.lastStreamRotationAt).toBe(11_000);
    expect(effects).toEqual([]);
  });

  test('does not skip or persist after a current replacement attempt finds no candidate', async () => {
    const state = createServiceWorkerState();
    const effects: string[] = [];
    const opened = await rotateStreamer(state, 'stalled-progress', {
      onOpenStreamer: async () => false,
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
    expect(opened).toBe(false);
    expect(effects).toEqual([]);
  });
});
