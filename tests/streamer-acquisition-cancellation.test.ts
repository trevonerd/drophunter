import { describe, expect, test } from 'bun:test';
import {
  currentFarmingSessionEpoch,
  invalidateFarmingSessionEpoch,
} from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { acquireStreamerForSelectedGame } from '../src/background/streamer-acquisition.ts';
import { TwitchDirectoryUnavailableError } from '../src/background/twitch-api/errors.ts';

describe('streamer acquisition cancellation', () => {
  test.each([
    'stop',
    'restart',
  ] as const)('ignores a pending directory rejection after %s', async (action) => {
    const state = createServiceWorkerState();
    const campaign = { id: 'game-a', campaignId: 'campaign-a', name: 'Game A', imageUrl: '' };
    state.appState.selectedGame = campaign;
    state.appState.isRunning = true;
    const epoch = currentFarmingSessionEpoch(state);
    let finishDirectory: () => void = () => undefined;
    const directoryReady = new Promise<void>((resolve) => {
      finishDirectory = resolve;
    });
    let saves = 0;
    let timingSaves = 0;
    const pending = acquireStreamerForSelectedGame(state, {
      isCurrent: () => currentFarmingSessionEpoch(state) === epoch,
      onOpenStreamer: async () => {
        await directoryReady;
        throw new TwitchDirectoryUnavailableError(new Error('offline'));
      },
      onSaveState: async () => {
        saves += 1;
      },
      onSaveTimingState: async () => {
        timingSaves += 1;
      },
    });

    invalidateFarmingSessionEpoch(state);
    state.appState.isRunning = action === 'restart';
    state.appState.selectedGame =
      action === 'stop' ? null : { ...campaign, campaignId: 'campaign-b', name: 'Game B' };
    const expectedState = structuredClone(state);
    finishDirectory();

    expect(await pending).toBe(false);
    expect(state).toEqual(expectedState);
    expect(saves).toBe(0);
    expect(timingSaves).toBe(0);
  });
});
