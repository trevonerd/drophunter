import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import {
  createWatchTransportAdapters as createAdapters,
  createWatchHealth as createHealth,
  createWatchTransportState,
  farmableSessionGame as game,
} from '../support/farming-session-watch-transport.ts';

let chromeMocks: ChromeMocks;

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

describe('farming session watch transport integration', () => {
  test('start, tick, and stop delegate to the configured transport', async () => {
    const state = createWatchTransportState(game);
    state.appState.watchTransportPreference = 'tabless';
    let starts = 0;
    let ticks = 0;
    let stops = 0;
    const health = createHealth('tabless');
    const watchTransport = {
      start: async () => {
        starts += 1;
        return { kind: 'started' as const, health };
      },
      tick: async () => {
        ticks += 1;
        return health;
      },
      stop: async () => {
        stops += 1;
      },
      setPreference: async () => {},
    };
    const session = createFarmingSession(state, createAdapters({ watchTransport }));

    const started = await session.handleStartFarming({ game });
    await session.checkDropProgress();
    await session.handleStopFarming();

    expect(started.success).toBe(true);
    expect(starts).toBe(1);
    expect(ticks).toBe(1);
    expect(stops).toBe(1);
  });
});
