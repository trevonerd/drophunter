import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { computeEffectiveStallThreshold } from '../src/background/stream-rotation.ts';
import type { WatchHealthSnapshot } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

test.each(['startup grace', 'recent progress', 'expired protection'] as const)(
  'managed transport failures use existing validation with %s',
  async (protection) => {
    const mocks = setupChromeMocks();
    try {
      const state = createServiceWorkerState();
      const game = createGame({ categorySlug: 'test-game' });
      const drop = createDrop({ requiredMinutes: 240, currentMinutes: 48, progress: 20 });
      const incumbent = createStreamer();
      state.appState.isRunning = true;
      state.appState.selectedGame = game;
      state.appState.availableGames = [game];
      state.appState.queue = [game];
      state.appState.activeStreamer = incumbent;
      state.appState.tabId = 8;
      state.appState.currentDrop = drop;
      state.appState.allDrops = [drop];
      state.appState.pendingDrops = [drop];
      state.cachedDropsSnapshot = [drop];
      state.hasCurrentGenerationCampaignValidation = true;
      state.lastInventoryRefreshAt = Date.now();
      state.lastFullRefreshAt = Date.now();
      state.streamValidationGraceUntil = protection === 'startup grace' ? Date.now() + 60_000 : 0;
      state.lastProgressAdvanceAt =
        Date.now() - (protection === 'recent progress' ? 6 * 60_000 : 30 * 60_000);
      expect(computeEffectiveStallThreshold(drop.requiredMinutes)).toBe(14 * 60_000);
      mocks.tabs.get = async (id) => ({
        id,
        windowId: 1,
        url: `https://www.twitch.tv/${incumbent.name}`,
        status: 'complete',
      });
      let discoveries = 0;
      const session = createFarmingSession(
        state,
        createFarmingSessionAdapters({
          fetchDirectoryStreamersFromApi: async () => {
            discoveries += 1;
            return Object.assign([], { languageFilterApplied: false });
          },
          fetchStreamContext: async () => ({
            channelName: incumbent.name,
            categorySlug: 'stale-twitch-category',
            categoryLabel: 'Stale category',
            streamTitle: 'Drops',
            titleContainsDrops: true,
            hasDropsSignal: true,
            isLive: true,
            pageUrl: `https://www.twitch.tv/${incumbent.name}`,
          }),
          watchTransport: {
            start: async () => ({ kind: 'cancelled' }),
            tick: async () => ({
              mode: 'managed-tab',
              status: 'failed',
              reason: 'wrong-game',
              isHealthy: false,
              consecutiveFailures: 3,
              consecutiveStalls: 0,
              progress: null,
              shouldFallback: true,
              checkedAt: Date.now(),
            }),
            stop: async () => {},
            setPreference: async () => {},
          },
        }),
      );
      await session.checkDropProgress();
      if (protection === 'expired protection') {
        for (let check = 0; check < 3; check += 1) await session.checkDropProgress();
        expect(discoveries).toBe(1);
        expect(state.appState.recoveryReason).toBe('no-streamers');
        return;
      }
      expect(discoveries).toBe(0);
      expect(state.appState.activeStreamer).toEqual(incumbent);
      expect(state.appState.recoveryReason).toBeNull();
    } finally {
      mocks.teardown();
    }
  },
);

test('unavailable tabless service preserves the campaign and enters shared service recovery', async () => {
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
        start: async () => ({ kind: 'failed', health: failed }),
        tick: async () => failed,
        stop: async () => {},
        setPreference: async () => {},
      },
    }),
  );
  expect(await session.acquireStreamerForSelectedGame()).toBe(false);
  expect(state.appState.recoveryReason).toBe('directory-unavailable');
  expect(state.apiBackoffUntil).toBe(0);
  expect(state.appState.activeStreamer).toBeNull();
  expect(state.appState.selectedGame?.id).toBe(game.id);
  expect(state.appState.queue).toEqual([game]);
});
