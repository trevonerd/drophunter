import { describe, expect, test } from 'bun:test';
import { openBestStreamerForSelectedGame } from '../../src/background/streamer-acquisition.ts';
import { createGame, createMinimalState, createStreamer } from '../fixtures/queue-management.ts';

export function registerQueue21Part01() {
  describe('openBestStreamerForSelectedGame', () => {
    test('does not open streamers when allowed filter removes every candidate without language fallback', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ allowedChannels: ['allowed-only'] });

      const streamers = [
        createStreamer({ id: 'alpha', name: 'alpha' }),
        createStreamer({ id: 'beta', name: 'beta' }),
      ];
      let seenCandidates: string[] = [];
      let openedStreamer: string | null = null;
      const fetchLanguages: string[] = [];

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async (_game, _force, language = '') => {
            fetchLanguages.push(language);
            return Object.assign([...streamers], { languageFilterApplied: false }) as never;
          },
          onOpenForegroundChannel: async (streamer) => {
            openedStreamer = streamer.name;
          },
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

      expect(opened).toBe(false);
      expect(fetchLanguages).toEqual(['']);
      expect(seenCandidates).toEqual([]);
      expect(openedStreamer).toBeNull();
    });

    test('falls back to unfiltered allowed streamers when preferred language hides them', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ allowedChannels: ['allowed-one', 'allowed-two'] });
      state.appState.preferredStreamerLanguage = 'it';
      state.appState.streamerSelectionMode = 'low-view';

      const languageFilteredStreamers = [
        createStreamer({ id: 'italian-other', name: 'italian-other', broadcasterLanguage: 'it' }),
      ];
      const unfilteredStreamers = [
        createStreamer({ id: 'italian-other', name: 'italian-other', broadcasterLanguage: 'it' }),
        createStreamer({ id: 'allowed-one', name: 'allowed-one', broadcasterLanguage: 'en' }),
        createStreamer({ id: 'allowed-two', name: 'allowed-two', broadcasterLanguage: 'fr' }),
      ];
      const fetchLanguages: string[] = [];
      const seenSelections: Array<{
        names: string[];
        mode: string;
        preferredLanguage: string | null;
        filterApplied: boolean;
      }> = [];
      let openedStreamer: string | null = null;

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async (_game, _force, language = '') => {
            fetchLanguages.push(language);
            const result = language ? languageFilteredStreamers : unfilteredStreamers;
            return Object.assign([...result], { languageFilterApplied: Boolean(language) }) as never;
          },
          onOpenForegroundChannel: async (streamer) => {
            openedStreamer = streamer.name;
          },
        },
        {
          dropMatchesSelectedGame: () => false,
          isRewardAcquired: () => false,
          getGameDisplayLabel: (item) => item.name,
          resolveCategorySlug: async () => 'test-game',
          pickStreamerForPreferences: (candidates, prefs, _randomFn, filterApplied) => {
            seenSelections.push({
              names: candidates.map((item) => item.name),
              mode: prefs.mode,
              preferredLanguage: prefs.preferredLanguage,
              filterApplied,
            });
            return {
              streamer: candidates[0] ?? null,
              activePoolSize: candidates.length,
              preferredLanguageApplied: false,
              preferredLanguageMatches: 0,
            };
          },
          normalizePreferredStreamerLanguage: (language) => language ?? null,
        },
      );

      expect(opened).toBe(true);
      expect(fetchLanguages).toEqual(['it', '']);
      expect(seenSelections).toEqual([
        {
          names: ['allowed-one', 'allowed-two'],
          mode: 'random',
          preferredLanguage: null,
          filterApplied: false,
        },
      ]);
      expect(openedStreamer).toBe('allowed-one');
    });

    test('does not open a streamer when unfiltered fallback still has no allowed channels', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ allowedChannels: ['allowed-only'] });
      state.appState.preferredStreamerLanguage = 'it';

      const languageFilteredStreamers = [
        createStreamer({ id: 'italian-other', name: 'italian-other', broadcasterLanguage: 'it' }),
      ];
      const unfilteredStreamers = [
        createStreamer({ id: 'alpha', name: 'alpha', broadcasterLanguage: 'en' }),
        createStreamer({ id: 'beta', name: 'beta', broadcasterLanguage: 'fr' }),
      ];
      const fetchLanguages: string[] = [];
      let seenCandidates: string[] = [];
      let openedStreamer: string | null = null;

      const opened = await openBestStreamerForSelectedGame(
        state,
        {
          onFetchDirectoryStreamersFromApi: async (_game, _force, language = '') => {
            fetchLanguages.push(language);
            const result = language ? languageFilteredStreamers : unfilteredStreamers;
            return Object.assign([...result], { languageFilterApplied: Boolean(language) }) as never;
          },
          onOpenForegroundChannel: async (streamer) => {
            openedStreamer = streamer.name;
          },
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

      expect(opened).toBe(false);
      expect(fetchLanguages).toEqual(['it', '']);
      expect(seenCandidates).toEqual([]);
      expect(openedStreamer).toBeNull();
    });

    test('keeps filtered candidates when allowed filter leaves matches', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ allowedChannels: ['alpha', 'beta'] });

      const streamers = [
        createStreamer({ id: 'alpha', name: 'alpha' }),
        createStreamer({ id: 'beta', name: 'beta' }),
        createStreamer({ id: 'gamma', name: 'gamma' }),
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
      expect(seenCandidates).toEqual(['alpha', 'beta']);
    });

    test('uses all streamers directly when allowed is null', async () => {
      const state = createMinimalState();
      state.appState.selectedGame = createGame({ allowedChannels: null });

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
      expect(seenCandidates).toEqual(['alpha', 'beta']);
    });
  });
}
