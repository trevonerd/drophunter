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
});
