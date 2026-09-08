import { expect, test } from 'bun:test';
import { openBestStreamerForSelectedGame } from '../../src/background/streamer-acquisition.ts';
import { createGame, createMinimalState, createStreamer } from '../fixtures/queue-management.ts';

test('a cancelled acquisition does not open transport or publish a streamer after directory fetch', async () => {
  const state = createMinimalState();
  state.appState.selectedGame = createGame();
  let current = true;
  let releaseDirectory: () => void = () => {};
  const directory = new Promise<void>((resolve) => {
    releaseDirectory = resolve;
  });
  let transportStarts = 0;
  const acquisition = openBestStreamerForSelectedGame(
    state,
    {
      onFetchDirectoryStreamersFromApi: async () => {
        await directory;
        return Object.assign([createStreamer()], { languageFilterApplied: false });
      },
      onOpenForegroundChannel: async () => {},
      onOpenWatchTransport: async () => {
        transportStarts += 1;
        return true;
      },
      isCurrent: () => current,
    },
    {
      dropMatchesSelectedGame: () => false,
      isRewardAcquired: () => false,
      getGameDisplayLabel: (game) => game.name,
      resolveCategorySlug: async () => 'test-game',
      pickStreamerForPreferences: (candidates) => ({
        streamer: candidates[0] ?? null,
        activePoolSize: candidates.length,
        preferredLanguageApplied: false,
        preferredLanguageMatches: 0,
      }),
      normalizePreferredStreamerLanguage: () => null,
    },
  );
  await Promise.resolve();
  current = false;
  releaseDirectory();
  expect(await acquisition).toBe(false);
  expect(transportStarts).toBe(0);
  expect(state.appState.activeStreamer).toBeNull();
});
