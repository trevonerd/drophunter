import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  type CheckDropProgressCallbacks,
  checkDropProgress,
} from '../src/background/drops-tick-monitoring.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createGame } from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

let chrome: ChromeMocks;
let now = 1_000_000;
let clock: ReturnType<typeof spyOn<typeof Date, 'now'>>;

beforeEach(() => {
  chrome = setupChromeMocks();
  now = 1_000_000;
  clock = spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  clock.mockRestore();
  chrome.teardown();
});

test('a wake heartbeat replaces a suspended tick before its in-memory timer fires', async () => {
  // Given an operation suspended across a weekend, without executing timers.
  const state = createServiceWorkerState();
  state.appState.isRunning = true;
  state.appState.selectedGame = createGame();
  const suspended = Promise.withResolvers<boolean>();
  let transportCalls = 0;
  let refreshCalls = 0;
  let oldOperationIsCurrent: (() => boolean) | undefined;
  const callbacks: CheckDropProgressCallbacks = {
    onWatchTransportTick: async (isCurrent) => {
      transportCalls += 1;
      if (transportCalls === 1) {
        oldOperationIsCurrent = isCurrent;
        return suspended.promise;
      }
      return true;
    },
    onEnforcePlaybackPolicy: async () => {},
    onRotateStreamerIfInvalid: async () => {},
    onAcquireStreamerForSelectedGame: async () => false,
    onAttemptAutoClaimChannelPointsBonus: async () => false,
    onRefreshDropsData: async () => {
      refreshCalls += 1;
      return 'transient-failure';
    },
    onAutoClaimClaimableDrops: async () => false,
    onAdvanceQueueIfCompleted: async () => false,
    onSaveTimingState: async () => {},
  };
  const oldTick = checkDropProgress(state, callbacks);
  now += 72 * 60 * 60_000;

  // When the next browser event arrives before the old setTimeout callback.
  await checkDropProgress(state, callbacks);
  const currentAfterWake = oldOperationIsCurrent?.();
  suspended.resolve(false);
  await oldTick;

  // Then only the new generation can perform work or commit effects.
  expect(transportCalls).toBe(2);
  expect(currentAfterWake).toBe(false);
  expect(refreshCalls).toBe(0);
  expect(state.monitorTickInFlight).toBe(false);
});
