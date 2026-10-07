import { expect, test } from 'bun:test';
import { createFarmingSession } from '../src/background/farming-session.ts';
import { markQueueEntryManual } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeQueueMetadata } from '../src/shared/app-state-collection-normalizers.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  createDrop,
  createFarmingSessionAdapters,
  createGame,
  createStreamer,
} from './fixtures/queue-management.ts';

test('main ticks try one distinct playback candidate per retry deadline, then leave the campaign after three alternatives', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const state = createServiceWorkerState();
    const game = createGame();
    const drop = createDrop({ requiredMinutes: 60 });
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.selectedGame = game;
    state.appState.availableGames = [game];
    state.appState.queue = [game];
    state.appState.currentDrop = drop;
    state.appState.allDrops = [drop];
    state.appState.pendingDrops = [drop];
    state.cachedDropsSnapshot = [drop];
    state.hasCurrentGenerationCampaignValidation = true;
    state.lastInventoryRefreshAt = now;
    state.lastFullRefreshAt = now;
    const opened: string[] = [];
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        fetchDirectoryStreamersFromApi: async () =>
          Object.assign(
            Array.from({ length: 5 }, (_, index) => createStreamer({ name: `candidate-${index}` })),
            { languageFilterApplied: false },
          ),
        watchTransport: {
          start: async (streamer) => {
            opened.push(streamer.name);
            return { kind: 'failed', health: null };
          },
          tick: async () => {
            throw new Error('No watch is running during acquisition recovery');
          },
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await session.checkDropProgress();
      expect(opened).toHaveLength(attempt);
      expect(new Set(opened).size).toBe(attempt);
      if (attempt < 4) {
        expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.attemptedStreamerNames).toEqual(opened);
        expect(state.recoveryBackoffUntil).toBe(now + 30_000);
        now += 29_999;
        await session.checkDropProgress();
        expect(opened).toHaveLength(attempt);
        now += 1;
        state.lastInventoryRefreshAt = now;
      }
    }
    expect(state.appState.queueEntryMetadataByKey[gameKey(game)]?.streamerRetryReason).toBe('open-failed');
    expect(state.appState.queueAcquisitionRound?.attemptedCampaignKeys).toContain(gameKey(game));
    expect(state.unverifiableRewardsByKey).toEqual({});
    await session.checkDropProgress();
    expect(opened).toHaveLength(4);
  } finally {
    Date.now = realNow;
  }
});

test('failed playback names survive normalized JSON persistence, are bounded, and explicit Start clears them', () => {
  const state = createServiceWorkerState();
  const game = createGame();
  const key = gameKey(game);
  const normalized = normalizeQueueMetadata({
    [key]: {
      source: 'manual',
      addedAt: 1,
      reason: 'user-added',
      attemptedStreamerNames: [' A ', 'a', null, 'B', 'c', 'd', 'e'],
    },
  });
  state.appState.queueEntryMetadataByKey = normalizeQueueMetadata(JSON.parse(JSON.stringify(normalized)));
  expect(state.appState.queueEntryMetadataByKey[key]).toEqual({
    source: 'manual',
    addedAt: 1,
    reason: 'user-added',
    attemptedStreamerNames: ['a', 'b', 'c', 'd'],
  });
  markQueueEntryManual(state, game);
  expect(state.appState.queueEntryMetadataByKey[key]?.attemptedStreamerNames).toBeUndefined();
});
