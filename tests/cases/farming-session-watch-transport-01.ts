import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession } from '../../src/background/farming-session.ts';
import type { WatchHealth } from '../../src/background/watch-transport.ts';
import type { TwitchGame } from '../../src/types/index.ts';
import { type ChromeMocks, setupChromeMocks } from '../mocks/chrome.ts';
import {
  createWatchTransportAdapters as createAdapters,
  createWatchHealth as createHealth,
  createWatchTransportState,
  createWatchTransportDrop as fixtureDrop,
  farmableSessionGame as game,
  watchTransportStreamer as streamer,
} from '../support/farming-session-watch-transport.ts';

let chromeMocks: ChromeMocks;

const nextGame: TwitchGame = {
  ...game,
  id: 'game-2',
  name: 'Next Game',
  campaignId: 'campaign-2',
  categorySlug: 'next-game',
};

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

describe('farming session watch transport integration', () => {
  test('heartbeat stall flags do not replace the reward-duration observation window', async () => {
    const realDateNow = Date.now;
    const now = 1_000_000;
    Date.now = () => now;
    const state = createWatchTransportState(game);
    state.appState.selectedGame = game;
    state.appState.queue = [game, nextGame];
    state.appState.availableGames = [game, nextGame];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    state.appState.watchTransportPreference = 'tabless';
    state.lastProgressAdvanceAt = now;
    let campaignRefreshes = 0;
    let inventoryRefreshes = 0;
    let hiddenStarts = 0;
    let foregroundOpens = 0;
    const stalledHealth: WatchHealth = {
      ...createHealth('tabless'),
      consecutiveStalls: 10,
    };

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => {
            campaignRefreshes += 1;
            return {
              games: [game, nextGame],
              drops: [fixtureDrop(game)],
              campaignsVerified: true,
              inventoryVerified: true,
              updatedAt: now,
            };
          },
          fetchInventorySnapshotFromApi: async (drops) => {
            inventoryRefreshes += 1;
            return { games: [game, nextGame], drops, inventoryVerified: true, updatedAt: now };
          },
          openForegroundChannel: async () => {
            foregroundOpens += 1;
          },
          watchTransport: {
            start: async () => {
              hiddenStarts += 1;
              return { kind: 'started', health: createHealth('tabless') };
            },
            tick: async () => stalledHealth,
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );

      await session.checkDropProgress();

      expect(state.stalledRecoveryAttempts).toBe(0);
      expect(state.appState.recoveryReason).toBeNull();
      expect(state.recoveryBackoffUntil).toBe(0);
      expect(campaignRefreshes).toBe(0);
      expect(inventoryRefreshes).toBeGreaterThan(0);
      expect(hiddenStarts).toBe(0);
      expect(foregroundOpens).toBe(0);
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
    } finally {
      Date.now = realDateNow;
    }
  });
});
