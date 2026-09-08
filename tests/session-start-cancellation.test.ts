import { describe, expect, test } from 'bun:test';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { handleStartFarming } from '../src/background/session-lifecycle.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';
import { createDeferred } from './support/farming-automation-fixtures.ts';

const game: TwitchGame = {
  id: 'game-1',
  name: 'Game 1',
  imageUrl: '',
  campaignId: 'campaign-1',
};

const drop: TwitchDrop = {
  id: 'drop-1',
  name: 'Drop 1',
  gameId: game.id,
  gameName: game.name,
  imageUrl: '',
  campaignId: game.campaignId,
  progress: 10,
  currentMinutes: 10,
  requiredMinutes: 60,
  remainingMinutes: 50,
  claimed: false,
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};

function createReadyState() {
  const state = createServiceWorkerState();
  state.appState.availableGames = [game];
  state.appState.pendingDrops = [drop];
  state.appState.currentDrop = drop;
  state.appState.selectedGame = game;
  return state;
}

function expectUnstarted(state: ReturnType<typeof createReadyState>) {
  expect({
    isRunning: state.appState.isRunning,
    queue: state.appState.queue,
    selectedGame: state.appState.selectedGame,
    tickGeneration: state.tickGeneration,
  }).toEqual({
    isRunning: false,
    queue: [],
    selectedGame: game,
    tickGeneration: 0,
  });
}

describe('cancellable farming start', () => {
  test('does not commit a start when workspace resolution finishes after cancellation', async () => {
    const state = createReadyState();
    const workspace = createDeferred<void>();
    let current = true;
    let refreshCalls = 0;

    const start = handleStartFarming(
      state,
      { game },
      {
        isCurrent: () => current,
        onEnsureWorkspace: async () => workspace.promise,
        onRefreshDropsData: async () => {
          refreshCalls += 1;
        },
      },
    );
    current = false;
    workspace.resolve(undefined);

    await expect(start).resolves.toEqual({ success: false, error: 'Farming start was superseded.' });
    expect(refreshCalls).toBe(0);
    expectUnstarted(state);
  });

  test('does not commit a start when refresh finishes after cancellation', async () => {
    const state = createReadyState();
    const refresh = createDeferred<void>();
    let current = true;
    let saveCalls = 0;

    const start = handleStartFarming(
      state,
      { game },
      {
        isCurrent: () => current,
        onEnsureWorkspace: async () => {},
        onRefreshDropsData: async () => refresh.promise,
        onSaveState: async () => {
          saveCalls += 1;
        },
      },
    );
    await Promise.resolve();
    current = false;
    refresh.resolve(undefined);

    await expect(start).resolves.toEqual({ success: false, error: 'Farming start was superseded.' });
    expect(saveCalls).toBe(0);
    expectUnstarted(state);
  });

  test('does not reinsert a campaign removed by guarded preflight refresh', async () => {
    const state = createReadyState();

    await expect(
      handleStartFarming(
        state,
        { game },
        {
          isCurrent: () => true,
          onRefreshDropsData: async () => {
            state.appState.availableGames = [];
            state.appState.pendingDrops = [];
            state.appState.currentDrop = null;
          },
        },
      ),
    ).resolves.toEqual({ success: false, error: 'Campaign is no longer available.' });
    expectUnstarted(state);
  });

  test('projects refreshed cached drops for the requested campaign before a guarded start validates it', async () => {
    const state = createReadyState();
    state.cachedDropsSnapshot = [drop];

    await expect(
      handleStartFarming(
        state,
        { game },
        {
          isCurrent: () => true,
          onRefreshDropsData: async () => {
            state.appState.pendingDrops = [];
            state.appState.currentDrop = null;
          },
        },
      ),
    ).resolves.toEqual({ success: true });
    expect(state.appState.currentDrop?.id).toBe(drop.id);
  });
});
