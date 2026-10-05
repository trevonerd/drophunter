import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { WatchHealthSnapshot } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';

test('failed tabless playback preserves the campaign and enters local playback recovery', async () => {
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  const game = createGame();
  const drop = createDrop({ gameId: game.id });
  state.appState.selectedGame = game;
  state.appState.queue = [game];
  state.appState.allDrops = [drop];
  state.cachedDropsSnapshot = [drop];
  const failed: WatchHealthSnapshot = {
    mode: 'tabless',
    status: 'failed',
    reason: 'error',
    isHealthy: false,
    consecutiveFailures: 1,
    consecutiveStalls: 0,
    progress: null,
    shouldFallback: true,
    checkedAt: Date.now(),
  };
  const session = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchDirectoryStreamersFromApi: async () =>
        Object.assign([createStreamer()], { languageFilterApplied: false }),
      watchTransport: {
        start: async () => failed,
        tick: async () => failed,
        stop: async () => {},
        setPreference: async () => {},
      },
    }),
  );
  expect(await session.acquireStreamerForSelectedGame()).toBe(false);
  expect(state.appState.recoveryReason).toBe('open-failed');
  expect(state.apiBackoffUntil).toBe(0);
  expect(state.appState.activeStreamer).toBeNull();
  expect(state.appState.selectedGame?.id).toBe(game.id);
  expect(state.appState.queue).toEqual([game]);
});
