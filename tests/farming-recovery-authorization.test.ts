import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createFarmingSessionAdapters, createGame } from './fixtures/queue-management.ts';

test.each(['stop', 'pause', 'sign-in'] as const)('late recovery callbacks respect %s', async (condition) => {
  const state = createServiceWorkerState();
  state.appState.selectedGame = createGame();
  state.appState.queue = [state.appState.selectedGame];
  state.appState.isRunning = condition === 'pause';
  state.appState.isPaused = condition === 'pause';
  state.appState.lastStopReason =
    condition === 'stop' ? 'user-stop' : condition === 'sign-in' ? 'sign-in-required' : null;
  state.appState.recoveryReason = 'no-streamers';
  let searches = 0;
  const session = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchDirectoryStreamersFromApi: async () => {
        searches += 1;
        return Object.assign([], { languageFilterApplied: false });
      },
    }),
  );
  expect(await session.acquireStreamerForSelectedGame()).toBe(false);
  expect(await session.acquireStreamerForSelectedGame()).toBe(false);
  expect(searches).toBe(0);
  expect(state.appState.isRunning).toBe(condition === 'pause');
});
