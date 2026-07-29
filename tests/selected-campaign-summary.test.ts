import { expect, test } from 'bun:test';
import { handleSetSelectedGame } from '../src/background/drops-tick.ts';
import { removeGameFromQueue, resolveGameFromState } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';

function campaign(overrides: Partial<TwitchGame> = {}): TwitchGame {
  return {
    id: 'game-id',
    name: 'Example Game',
    imageUrl: '',
    campaignId: 'campaign-id',
    campaignName: 'Example Campaign',
    ...overrides,
  };
}

function reward(overrides: Partial<TwitchDrop>): TwitchDrop {
  return {
    id: 'reward-id',
    name: 'Reward',
    gameId: 'game-id',
    gameName: 'Example Game',
    imageUrl: '',
    campaignId: 'campaign-id',
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'subscription',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
    ...overrides,
  };
}

test('SET_SELECTED_GAME keeps an inspected subscription-only summary after selecting another campaign', async () => {
  // Given
  const state = createServiceWorkerState();
  const selectedCampaign = campaign();
  selectedCampaign.dropCount = 5;
  const otherCampaign = campaign({
    id: 'other-game-id',
    name: 'Other Game',
    campaignId: 'other-campaign-id',
    campaignName: 'Other Campaign',
  });
  state.appState.availableGames = [selectedCampaign, otherCampaign];
  state.appState.selectedGame = selectedCampaign;
  state.appState.allDrops = [
    reward({ id: 'approach-vector', name: 'Approach Vector' }),
    reward({ id: 'charmalure-set', name: 'Charmalure Set' }),
    reward({ id: 'launch-paperwork', name: 'Launch Paperwork', progress: 100, claimed: true }),
    reward({ id: 'sonia-the-sonar', name: 'Sonia The Sonar', progress: 100, claimed: true }),
    reward({ id: 'trip-report', name: 'Trip Report', progress: 100, claimed: true }),
  ];
  let savedCampaign: TwitchGame | undefined;
  const callbacks = {
    onTrackActivity: async () => undefined,
    onEnsureWorkspace: async () => undefined,
    onRefreshDropsData: async () => {
      state.appState.allDrops = [];
    },
    onOpenBestStreamer: async () => true,
    onSaveState: async (savedState: typeof state) => {
      savedCampaign = savedState.appState.availableGames.find(
        (game) => game.campaignId === selectedCampaign.campaignId,
      );
    },
    onSaveTimingState: async () => undefined,
  };
  const deps = {
    resolveGameFromState,
    removeGameFromQueue,
    splitDropsForSelectedGame: () => undefined,
    getGameDisplayLabel: (game: TwitchGame) => game.name,
    logDebug: () => undefined,
    logWarn: () => undefined,
  };

  // When
  const switchResult = await handleSetSelectedGame(state, { game: otherCampaign }, callbacks, deps);

  // Then
  expect(switchResult.success).toBe(true);
  expect(savedCampaign?.rewardSummary).toEqual({
    completion: 'farming-complete',
    remainderReasons: ['subscription-required'],
  });
});

test('SET_SELECTED_GAME does not persist all-acquired from a partial inspected reward set', async () => {
  // Given
  const state = createServiceWorkerState();
  const selectedCampaign = campaign({
    dropCount: 2,
    rewardSummary: { completion: 'farmable', remainderReasons: [] },
  });
  const otherCampaign = campaign({
    id: 'other-game-id',
    name: 'Other Game',
    campaignId: 'other-campaign-id',
    campaignName: 'Other Campaign',
  });
  state.appState.availableGames = [selectedCampaign, otherCampaign];
  state.appState.selectedGame = selectedCampaign;
  state.appState.allDrops = [
    reward({ id: 'only-visible-reward', progress: 100, claimed: true, acquisitionMethod: 'watch-time' }),
  ];
  let savedCampaign: TwitchGame | undefined;
  const callbacks = {
    onTrackActivity: async () => undefined,
    onEnsureWorkspace: async () => undefined,
    onRefreshDropsData: async () => {
      state.appState.allDrops = [];
    },
    onOpenBestStreamer: async () => true,
    onSaveState: async (savedState: typeof state) => {
      savedCampaign = savedState.appState.availableGames.find(
        (game) => game.campaignId === selectedCampaign.campaignId,
      );
    },
    onSaveTimingState: async () => undefined,
  };
  const deps = {
    resolveGameFromState,
    removeGameFromQueue,
    splitDropsForSelectedGame: () => undefined,
    getGameDisplayLabel: (game: TwitchGame) => game.name,
    logDebug: () => undefined,
    logWarn: () => undefined,
  };

  // When
  await handleSetSelectedGame(state, { game: otherCampaign }, callbacks, deps);

  // Then
  expect(savedCampaign?.rewardSummary).toEqual({ completion: 'farmable', remainderReasons: [] });
});
