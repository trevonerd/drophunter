import { describe, expect, test } from 'bun:test';
import { openBestStreamerForSelectedGame } from '../../src/background/streamer-acquisition.ts';
import { createGame, createMinimalState, createStreamer } from '../fixtures/queue-management.ts';

export function registerQueue21Part02() {
  describe('openBestStreamerForSelectedGame', () => {
    test('preserves managed tab id when no streamer is found so the next game can reuse it', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ name: 'No Live Game' });
      state.appState.tabId = 123;
      state.appState.activeStreamer = {
        id: 'old-streamer',
        name: 'old-streamer',
        displayName: 'Old Streamer',
        isLive: true,
      };

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async () =>
            Object.assign([], { languageFilterApplied: false }) as never,
          onOpenForegroundChannel: async () => {
            throw new Error('should not open a channel without candidates');
          },
        },
        {
          dropMatchesSelectedGame: () => true,
          isRewardAcquired: () => false,
          getGameDisplayLabel: (item) => item.name,
          resolveCategorySlug: async () => 'no-live-game',
          pickStreamerForPreferences: () => ({
            streamer: null,
            activePoolSize: 0,
            preferredLanguageApplied: false,
            preferredLanguageMatches: 0,
          }),
          normalizePreferredStreamerLanguage: () => null,
        },
      );

      expect(opened).toBe(false);
      expect(state.appState.tabId).toBe(123);
      expect(state.appState.activeStreamer).toBeNull();
    });

    test('excludes the channel we just rotated away from so rotation changes streamer', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.avoidStreamerName = 'alpha';

      const streamers = [
        createStreamer({ id: 'alpha', name: 'alpha' }),
        createStreamer({ id: 'beta', name: 'beta' }),
      ];
      let seenCandidates: string[] = [];

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async () =>
            Object.assign([...streamers], { languageFilterApplied: false }) as never,
          onOpenForegroundChannel: async () => undefined,
        },
        {
          dropMatchesSelectedGame: () => false,
          isRewardAcquired: () => false,
          getGameDisplayLabel: (item) => item.name,
          resolveCategorySlug: async () => 'test-game',
          pickStreamerForPreferences: (candidates) => {
            seenCandidates = candidates.map((item) => item.name);
            return {
              streamer: candidates[0] ?? null,
              activePoolSize: candidates.length,
              preferredLanguageApplied: false,
              preferredLanguageMatches: 0,
            };
          },
          normalizePreferredStreamerLanguage: () => null,
        },
      );

      expect(opened).toBe(true);
      expect(seenCandidates).toEqual(['beta']);
      expect(state.avoidStreamerName).toBeNull();
    });

    test('keeps the avoided channel when it is the only live candidate', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.avoidStreamerName = 'alpha';

      const streamers = [createStreamer({ id: 'alpha', name: 'alpha' })];
      let seenCandidates: string[] = [];

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async () =>
            Object.assign([...streamers], { languageFilterApplied: false }) as never,
          onOpenForegroundChannel: async () => undefined,
        },
        {
          dropMatchesSelectedGame: () => false,
          isRewardAcquired: () => false,
          getGameDisplayLabel: (item) => item.name,
          resolveCategorySlug: async () => 'test-game',
          pickStreamerForPreferences: (candidates) => {
            seenCandidates = candidates.map((item) => item.name);
            return {
              streamer: candidates[0] ?? null,
              activePoolSize: candidates.length,
              preferredLanguageApplied: false,
              preferredLanguageMatches: 0,
            };
          },
          normalizePreferredStreamerLanguage: () => null,
        },
      );

      expect(opened).toBe(true);
      expect(seenCandidates).toEqual(['alpha']);
    });

    test('keeps avoidStreamerName set when no streamer is opened, so a retry still excludes it', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame();
      state.avoidStreamerName = 'alpha';

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async () =>
            Object.assign([], { languageFilterApplied: false }) as never,
          onOpenForegroundChannel: async () => undefined,
        },
        {
          dropMatchesSelectedGame: () => false,
          isRewardAcquired: () => false,
          getGameDisplayLabel: (item) => item.name,
          resolveCategorySlug: async () => 'test-game',
          pickStreamerForPreferences: () => ({
            streamer: null,
            activePoolSize: 0,
            preferredLanguageApplied: false,
            preferredLanguageMatches: 0,
          }),
          normalizePreferredStreamerLanguage: () => null,
        },
      );

      expect(opened).toBe(false);
      expect(state.avoidStreamerName).toBe('alpha');
    });
  });
}
