import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchStreamer } from '../src/types/index.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';
import { setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

test('public Stop completes while public Start waits for the Twitch directory', async () => {
  const chrome = setupChromeMocks();
  const state = createServiceWorkerState();
  const game = createGame({ campaignId: 'stop-campaign' });
  const drop = createDrop({ gameId: game.id, campaignId: game.campaignId });
  state.appState.selectedGame = game;
  state.appState.availableGames = [game];
  state.appState.queue = [game];
  state.appState.allDrops = [drop];
  state.appState.pendingDrops = [drop];
  state.appState.currentDrop = drop;
  state.cachedDropsSnapshot = [drop];
  const directory = createDeferred<TwitchStreamer[] & { languageFilterApplied: boolean }>();
  const started = createDeferred<void>();
  let opened = 0;
  const session = createFarmingSession(
    state,
    createFarmingSessionAdapters({
      fetchDropsSnapshotFromApi: async () => ({ games: [game], drops: [drop], updatedAt: Date.now() }),
      fetchDirectoryStreamersFromApi: async () => {
        started.resolve(undefined);
        return directory.promise;
      },
      openForegroundChannel: async () => {
        opened += 1;
      },
    }),
  );
  let starting: ReturnType<typeof session.handleStartFarming> | undefined;
  try {
    starting = session.handleStartFarming({ game }, () => true);
    await started.promise;
    const stopped = session.handleStopFarming();
    expect(state.appState.isRunning).toBe(false);
    const completed = await Promise.race([
      stopped.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(completed).toBe(true);
    expect(state.appState.manualQueueAuthorized).toBe(false);
    directory.resolve(Object.assign([createStreamer()], { languageFilterApplied: false }));
    await starting;
    expect(opened).toBe(0);
    expect(state.appState.isRunning).toBe(false);
  } finally {
    directory.resolve(Object.assign([], { languageFilterApplied: false }));
    await starting;
    chrome.teardown();
  }
});
