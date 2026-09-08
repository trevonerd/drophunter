import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { TICK_WATCHDOG_TIMEOUT_MS } from '../src/background/constants.ts';
import {
  type CheckDropProgressCallbacks,
  checkDropProgress,
} from '../src/background/drops-tick-monitoring.ts';
import { createGame, createMinimalState } from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

function callbacks(overrides: Partial<CheckDropProgressCallbacks> = {}): CheckDropProgressCallbacks {
  return {
    onEnforcePlaybackPolicy: async () => {},
    onRotateStreamerIfInvalid: async () => {},
    onAcquireStreamerForSelectedGame: async () => false,
    onAttemptAutoClaimChannelPointsBonus: async () => false,
    onRefreshDropsData: async () => {},
    onAutoClaimClaimableDrops: async () => false,
    onAdvanceQueueIfCompleted: async () => true,
    onSaveTimingState: async () => {},
    ...overrides,
  };
}

describe('monitoring tick ownership', () => {
  let chrome: ChromeMocks;
  beforeEach(() => {
    chrome = setupChromeMocks();
  });
  afterEach(() => {
    chrome.teardown();
  });

  test('a timed-out tick cannot continue work or unlock its replacement', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    state.appState.selectedGame = createGame();
    const oldTransport = Promise.withResolvers<boolean>();
    const newTransport = Promise.withResolvers<boolean>();
    const watchdogs: Array<() => void> = [];
    const nativeSetTimeout = globalThis.setTimeout;
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay) => {
      if (delay === TICK_WATCHDOG_TIMEOUT_MS && typeof handler === 'function') {
        watchdogs.push(() => handler());
        return nativeSetTimeout(() => {}, 0);
      }
      return nativeSetTimeout(handler, delay);
    });
    let staleWork = 0;
    let oldTick: Promise<void> | undefined;
    let newTick: Promise<void> | undefined;
    try {
      oldTick = checkDropProgress(
        state,
        callbacks({
          onWatchTransportTick: () => oldTransport.promise,
          onEnforcePlaybackPolicy: async () => {
            staleWork += 1;
          },
        }),
      );
      watchdogs[0]?.();
      newTick = checkDropProgress(state, callbacks({ onWatchTransportTick: () => newTransport.promise }));
      oldTransport.resolve(false);
      await oldTick;
      expect(staleWork).toBe(0);
      expect(state.monitorTickInFlight).toBe(true);
    } finally {
      oldTransport.resolve(false);
      newTransport.resolve(false);
      await Promise.all([oldTick, newTick]);
      timer.mockRestore();
    }
    expect(state.monitorTickInFlight).toBe(false);
  });

  test('skipped checks cannot refresh the heartbeat of a hung tick', async () => {
    const state = createMinimalState({ monitorTickInFlight: true, lastHeartbeatAt: 42 });
    state.appState.isRunning = true;
    await checkDropProgress(state, callbacks());
    expect(state.lastHeartbeatAt).toBe(42);
  });

  test('a cancelled inventory request does not delay the replacement session refresh', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    const requested = Promise.withResolvers<void>();
    const inventory = Promise.withResolvers<void>();
    let refreshes = 0;
    const oldTick = checkDropProgress(
      state,
      callbacks({
        onRefreshDropsData: async () => {
          refreshes += 1;
          requested.resolve();
          await inventory.promise;
        },
      }),
    );
    await requested.promise;
    state.tickGeneration += 1;
    state.monitorTickInFlight = false;
    inventory.resolve();
    await oldTick;
    await checkDropProgress(
      state,
      callbacks({
        onRefreshDropsData: async () => {
          refreshes += 1;
        },
      }),
    );
    expect(refreshes).toBe(2);
  });

  test('a stopped session cannot continue after an awaited transport check', async () => {
    const state = createMinimalState();
    state.appState.isRunning = true;
    const transport = Promise.withResolvers<boolean>();
    let work = 0;
    const tick = checkDropProgress(
      state,
      callbacks({
        onWatchTransportTick: () => transport.promise,
        onEnforcePlaybackPolicy: async () => {
          work += 1;
        },
      }),
    );
    state.appState.isRunning = false;
    transport.resolve(false);
    await tick;
    expect(work).toBe(0);
  });
});
