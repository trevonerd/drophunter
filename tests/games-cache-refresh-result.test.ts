import { expect, test } from 'bun:test';
import { refreshGamesCacheFromHiddenFetch } from '../src/background/games-cache-orchestration.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

test('a required fresh campaign snapshot distinguishes temporary unavailability from zero campaigns', async () => {
  const state = createServiceWorkerState();
  const cachedGame = { id: 'game-1', name: 'Saved Game', imageUrl: '' };
  state.appState.availableGames = [cachedGame];

  const result = await refreshGamesCacheFromHiddenFetch(
    state,
    { requireFreshSnapshot: true },
    {
      fetchDropsSnapshot: async () => null,
      replaceAvailableGames: (games) => games,
      annotateGameCompletion: (games) => games,
      normalizeGameSelection: () => {},
      normalizeQueueSelection: () => {},
      splitDropsForSelectedGame: () => {},
      recordEmptyCampaignObservation: () => ({ confirmed: true, streak: 1 }),
      resetStateForAuthoritativeEmptyCampaign: () => {},
      clearSelectedCompletedIdleCampaign: () => {},
      resetStreamTrackingState: () => {},
      clearRecoveryStatus: (appState) => appState,
      clearTerminalStopStatus: (appState) => appState,
      stopFarmingSession: async () => {},
      saveState: async () => {},
    },
  );

  expect(result).toEqual({ kind: 'unavailable', games: [cachedGame] });
  expect(state.appState.availableGames).toEqual([cachedGame]);
});
