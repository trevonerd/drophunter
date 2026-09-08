import { describe, expect, test } from 'bun:test';
import { invalidateFarmingSessionEpoch } from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { recoverStalledProgress } from '../src/background/stalled-progress-recovery.ts';
import { makeDrop } from './fixtures/auto-claim-drops.ts';

describe('stalled progress cancellation', () => {
  for (const action of ['stop', 'restart'] as const) {
    test.each([
      'campaign',
      'inventory',
      'tabless',
      'playback',
      'rotation',
      'save',
    ] as const)(`ignores pending %s recovery after ${action}`, async (boundary) => {
      const state = createServiceWorkerState();
      state.appState.isRunning = true;
      state.appState.selectedGame = { id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' };
      state.appState.currentDrop = makeDrop();
      state.stalledRecoveryAttempts = boundary === 'rotation' ? 1 : 0;
      let enterBoundary: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        enterBoundary = resolve;
      });
      let finishBoundary: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finishBoundary = resolve;
      });
      const effects: string[] = [];
      const step = async (name: string) => {
        effects.push(name);
        if (name !== boundary) return;
        enterBoundary();
        await finished;
      };
      const pending = recoverStalledProgress(
        state,
        boundary === 'tabless' ? { kind: 'tabless' } : { kind: 'managed-tab', tabId: 8 },
        {
          now: Date.now,
          onCampaignRefresh: async () => {
            await step('campaign');
            return 'refreshed';
          },
          onInventoryRefresh: async () => {
            await step('inventory');
            return 'refreshed';
          },
          onAdvanceQueueIfCompleted: async () => {
            await step('advance');
            return true;
          },
          onAttemptPlaybackSelfHeal: () => step('playback'),
          onRestartTablessWatcher: () => step('tabless'),
          onRotateManagedStreamer: () => step('rotation'),
          onSkipCurrentGame: () => step('skip'),
          onSaveState: () => step('save'),
          onSaveTimingState: () => step('timing'),
        },
      );
      await entered;
      invalidateFarmingSessionEpoch(state);
      state.appState.isRunning = action === 'restart';
      const expectedState = structuredClone(state);
      const expectedEffects = effects.slice();
      finishBoundary();
      expect(await pending).toEqual({ kind: 'selection-changed' });
      expect(state).toEqual(expectedState);
      expect(effects).toEqual(expectedEffects);
    });
  }
});
