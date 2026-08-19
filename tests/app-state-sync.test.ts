import { describe, expect, test } from 'bun:test';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import { createInitialState } from '../src/shared/utils.ts';

describe('normalizeStoredAppState', () => {
  test('returns a full initial state for nullish values', () => {
    expect(normalizeStoredAppState(null)).toEqual(createInitialState());
  });

  test('fills in missing app state fields from defaults', () => {
    const state = normalizeStoredAppState({
      isRunning: true,
      selectedGame: { id: '1', name: 'Game', imageUrl: '' },
    });

    expect(state.isRunning).toBe(true);
    expect(state.selectedGame?.name).toBe('Game');
    expect(state.queue).toEqual([]);
    expect(state.autoResumeOnStartup).toBe(false);
    expect(state.muteFarmingTab).toBe(true);
    expect(state.notificationsEnabled).toBe(false);
    expect(state.autoClaimChannelPointsBonus).toBe(true);
    expect(state.streamerSelectionMode).toBe('low-view');
    expect(state.preferredStreamerLanguage).toBeNull();
    expect(state.recoveryReason).toBeNull();
    expect(state.lastStopReason).toBeNull();
    expect(state.favoriteGames).toEqual([]);
    expect(state.hiddenGames).toEqual([]);
    expect(state.campaignPriorityMode).toBe('ending-soonest');
    expect(state.farmCategoryScope).toBe('all');
    expect(state.autoStartFavoriteGames).toBe(false);
    expect(state.queueEntryMetadataByKey).toEqual({});
    expect(state.automationActivity).toEqual([]);
    expect(state.lastAutomationMessage).toBeNull();
    expect(state.nextAutomationCheckAt).toBeNull();
    expect(state.manualWatchState).toBe('inactive');
    expect(state.campaignAvailabilityByKey).toEqual({});
    expect(state.campaignDropsByKey).toEqual({});
  });

  test('normalizes invalid automation preferences fail-closed', () => {
    const state = normalizeStoredAppState({
      favoriteGames: [{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 123 }],
      campaignPriorityMode: 'fastest',
      farmCategoryScope: 'everything',
      autoStartFavoriteGames: 'yes',
      queueEntryMetadataByKey: { broken: { source: 'unknown' } },
    });

    expect(state.favoriteGames).toEqual([{ gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 123 }]);
    expect(state.campaignPriorityMode).toBe('ending-soonest');
    expect(state.farmCategoryScope).toBe('all');
    expect(state.autoStartFavoriteGames).toBe(false);
    expect(state.queueEntryMetadataByKey).toEqual({});
  });

  test('normalizes hidden games and resolves malformed overlap in favor of hidden', () => {
    // Given: stored category preferences containing an overlap and malformed hidden records.
    const stored = {
      favoriteGames: [
        { gameId: 'valorant', lastKnownName: 'Valorant', addedAt: 100, identityKeys: ['509658'] },
        { gameId: 'other', lastKnownName: 'Other', addedAt: 110 },
      ],
      hiddenGames: [
        { gameId: 'valorant', lastKnownName: 'Valorant', hiddenAt: 200, identityKeys: ['509658', '509658'] },
        { gameId: '', lastKnownName: 'Broken', hiddenAt: 300 },
        { gameId: 'missing-time', lastKnownName: 'Broken' },
      ],
    };

    // When: persisted state crosses the normalization boundary.
    const state = normalizeStoredAppState(stored);

    // Then: hidden is durable, aliases are deduplicated, and it wins the overlap.
    expect(state.hiddenGames).toEqual([
      { gameId: 'valorant', lastKnownName: 'Valorant', hiddenAt: 200, identityKeys: ['509658'] },
    ]);
    expect(state.favoriteGames).toEqual([{ gameId: 'other', lastKnownName: 'Other', addedAt: 110 }]);
  });

  test('accepts retained-after-hide queue metadata', () => {
    // Given: a queued campaign retained by an explicit hide action.
    const stored = {
      queueEntryMetadataByKey: {
        retained: { source: 'manual', addedAt: 123, reason: 'retained-after-hide' },
      },
    };

    // When: state is restored after a service-worker restart.
    const state = normalizeStoredAppState(stored);

    // Then: retained ownership survives normalization.
    expect(state.queueEntryMetadataByKey).toEqual(stored.queueEntryMetadataByKey);
  });
});
