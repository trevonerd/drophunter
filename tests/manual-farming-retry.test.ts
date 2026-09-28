import { describe, expect, test } from 'bun:test';
import { retryFarmingNow } from '../src/background/manual-farming-retry.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

function setup() {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.selectedGame = { id: 'game', campaignId: 'campaign', name: 'Game', imageUrl: '' };
  state.appState.recoveryReason = 'open-failed';
  state.appState.recoveryBackoffUntil = Date.now() + 30_000;
  state.recoveryBackoffUntil = state.appState.recoveryBackoffUntil;
  const calls: string[] = [];
  const deps = {
    checkDropProgress: async () => {
      calls.push('tick');
    },
    acquireStreamerForSelectedGame: async () => {
      calls.push('acquire');
      return true;
    },
    saveState: async () => {
      calls.push('save');
    },
  };
  return { state, calls, deps };
}

describe('manual farming retry', () => {
  test('retries a local playback failure without waiting for its old deadline', async () => {
    const { state, calls, deps } = setup();
    expect(await retryFarmingNow(state, deps)).toEqual({ success: true });
    expect(calls).toEqual(['save', 'acquire']);
    expect(state.appState.recoveryBackoffUntil).toBeLessThanOrEqual(Date.now());
  });

  test('does not bypass Twitch cooldown or duplicate an active acquisition', async () => {
    const { state, calls, deps } = setup();
    state.apiBackoffUntil = Date.now() + 60_000;
    expect((await retryFarmingNow(state, deps)).success).toBe(false);
    expect(calls).toEqual([]);
    state.apiBackoffUntil = 0;
    state.streamerAcquisitionInFlight = Promise.resolve(false);
    expect(await retryFarmingNow(state, deps)).toEqual({ success: true });
    expect(calls).toEqual([]);
  });

  test('never starts a paused or unauthorized session', async () => {
    const { state, calls, deps } = setup();
    state.appState.isPaused = true;
    expect((await retryFarmingNow(state, deps)).success).toBe(false);
    state.appState.isPaused = false;
    state.appState.isRunning = false;
    expect((await retryFarmingNow(state, deps)).success).toBe(false);
    expect(calls).toEqual([]);
  });

  test('does not reopen playback when Stop wins during persistence', async () => {
    const { state, calls, deps } = setup();
    const result = await retryFarmingNow(state, {
      ...deps,
      saveState: async () => {
        state.appState.isRunning = false;
        calls.push('stop');
      },
    });
    expect(result.success).toBe(false);
    expect(calls).toEqual(['stop']);
  });
});
