import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dropStateKey } from '../../src/background/drops-projection.ts';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import {
  createWatchTransportAdapters as createAdapters,
  createWatchHealth as createHealth,
  createWatchTransportState,
  farmableSessionGame as game,
  watchTransportStreamer as streamer,
} from '../support/farming-session-watch-transport.ts';

let chromeMocks: ChromeMocks;

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

describe('farming session watch transport integration', () => {
  test('fresh Hidden progress clears recovery without restarting the watcher', async () => {
    const realDateNow = Date.now;
    const now = 2_000_000;
    Date.now = () => now;
    const state = createWatchTransportState(game);
    const staleDrop = state.appState.currentDrop;
    if (!staleDrop) throw new Error('Expected an active drop in the test fixture');
    state.appState.selectedGame = game;
    state.appState.queue = [game];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    state.appState.recoveryReason = 'stalled-progress';
    state.appState.recoveryAttempts = 1;
    state.stalledRecoveryAttempts = 1;
    state.recoveryBackoffUntil = now;
    state.lastTrackedDropKey = dropStateKey(staleDrop);
    state.lastTrackedProgress = staleDrop.progress;
    state.lastTrackedMinutes = staleDrop.currentMinutes ?? -1;
    const progressedDrop = { ...staleDrop, progress: 20, currentMinutes: 2, remainingMinutes: 8 };
    let hiddenStarts = 0;

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({
            games: [game],
            drops: [progressedDrop],
            campaignsVerified: false,
            inventoryVerified: true,
            updatedAt: now,
          }),
          fetchInventorySnapshotFromApi: async () => ({
            games: [game],
            drops: [progressedDrop],
            campaignsVerified: false,
            inventoryVerified: true,
            updatedAt: now,
          }),
          watchTransport: {
            start: async () => {
              hiddenStarts += 1;
              return { kind: 'started', health: createHealth('tabless') };
            },
            tick: async () => createHealth('tabless'),
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();

      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.appState.recoveryReason).toBeNull();
      expect(state.appState.currentDrop?.progress).toBe(20);
      expect(hiddenStarts).toBe(0);
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
    } finally {
      Date.now = realDateNow;
    }
  });
});
