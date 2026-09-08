import { expect, test } from 'bun:test';
import { checkDropProgress } from '../src/background/drops-tick-monitoring.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

test.each([
  false,
  true,
])('refreshes and claims during streamer retry backoff (campaign complete: %p)', async (complete) => {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.selectedGame = { id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' };
  state.appState.recoveryReason = 'no-streamers';
  state.recoveryBackoffUntil = complete ? Date.now() - 1 : Date.now() + 60_000;
  const effects: string[] = [];
  await checkDropProgress(state, {
    onEnforcePlaybackPolicy: async () => undefined,
    onRotateStreamerIfInvalid: async () => {
      effects.push('rotate');
    },
    onAcquireStreamerForSelectedGame: async () => {
      effects.push('acquire');
      return true;
    },
    onAttemptAutoClaimChannelPointsBonus: async () => false,
    onRefreshDropsData: async () => {
      effects.push('refresh');
      return 'refreshed';
    },
    onAutoClaimClaimableDrops: async () => {
      effects.push('claim');
      return false;
    },
    onAdvanceQueueIfCompleted: async () => {
      effects.push('advance');
      if (complete) state.appState.isRunning = false;
      return !complete;
    },
    onSaveTimingState: async () => {
      effects.push('timing');
    },
  });
  expect(effects).toEqual(['refresh', 'claim', 'advance', 'timing']);
});
