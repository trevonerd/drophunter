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
import { preparedWatch } from '../support/prepared-watch.ts';

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
  test('a partial snapshot preserves a missing campaign and its authorized target', async () => {
    const realDateNow = Date.now;
    const now = 3_000_000;
    Date.now = () => now;
    const state = createWatchTransportState(game);
    const nextDrop = fixtureDrop(nextGame, 'drop-2');
    state.appState.selectedGame = game;
    state.appState.queue = [game, nextGame];
    state.appState.availableGames = [game, nextGame];
    state.appState.isRunning = true;
    state.appState.activeStreamer = streamer;
    state.appState.watchTransportMode = 'tabless';
    state.appState.watchTransportPreference = 'tabless';
    let hiddenStarts = 0;
    const stalledHealth: WatchHealth = {
      ...createHealth('tabless'),
      consecutiveStalls: 10,
    };

    try {
      const session = createFarmingSession(
        state,
        createAdapters({
          fetchDropsSnapshotFromApi: async () => ({
            games: [nextGame],
            drops: [nextDrop],
            updatedAt: now,
          }),
          fetchInventorySnapshotFromApi: async () => ({
            games: [nextGame],
            drops: [nextDrop],
            updatedAt: now,
          }),
          watchTransport: {
            prepare: async (target) => {
              hiddenStarts += 1;
              return preparedWatch(target, createHealth('tabless'));
            },
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
      expect(state.appState.selectedGame?.campaignId).toBe(game.campaignId);
      expect(state.appState.queue.map((entry) => entry.campaignId)).toEqual([
        game.campaignId,
        nextGame.campaignId,
      ]);
      expect(hiddenStarts).toBe(0);
    } finally {
      Date.now = realDateNow;
    }
  });
});
