import { describe, expect, test } from 'bun:test';
import { handleSetSelectedGame } from '../../src/background/drops-tick.ts';
import { createRuntimeMessageListener } from '../../src/background/message-router.ts';
import { removeGameFromQueue, resolveGameFromState } from '../../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../../src/background/runtime-state.ts';
import { handleStartFarming } from '../../src/background/session-lifecycle.ts';
import { callListener, createGame, createHandlers } from '../support/message-router-fixtures.ts';

function createUnavailableCampaignState() {
  const state = createServiceWorkerState();
  const existingGame = createGame({ id: 'existing-game', campaignId: 'campaign-existing' });
  const requestedCampaign = createGame({
    id: 'shared-game-id',
    name: 'Shared Game',
    campaignId: 'campaign-missing',
  });
  const siblingCampaign = createGame({
    id: 'canonical-game-id',
    name: 'Shared Game',
    campaignId: 'campaign-sibling',
  });
  state.appState.availableGames = [siblingCampaign];
  state.appState.queue = [existingGame];
  state.appState.selectedGame = existingGame;
  return { state, requestedCampaign, existingGame };
}

describe('runtime message router', () => {
  test('rejects stale explicit START_FARMING campaigns without mutating runtime state', async () => {
    const { state, requestedCampaign, existingGame } = createUnavailableCampaignState();
    const listener = createRuntimeMessageListener(
      createHandlers({
        startFarming: async (message) => handleStartFarming(state, message.payload),
      }),
    );
    const queueBefore = [...state.appState.queue];

    const result = await callListener(listener, {
      type: 'START_FARMING',
      payload: { game: requestedCampaign },
    });

    expect(result.response).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(state.appState.queue).toEqual(queueBefore);
    expect(state.appState.selectedGame).toBe(existingGame);
    expect(state.appState.isRunning).toBe(false);
  });

  test('rejects stale explicit SET_SELECTED_GAME campaigns without mutating runtime state', async () => {
    const { state, requestedCampaign, existingGame } = createUnavailableCampaignState();
    const listener = createRuntimeMessageListener(
      createHandlers({
        setSelectedGame: async (message) =>
          handleSetSelectedGame(
            state,
            message.payload,
            {
              onTrackActivity: async () => undefined,
              onEnsureWorkspace: async () => undefined,
              onRefreshDropsData: async () => undefined,
              onOpenBestStreamer: async () => true,
              onSaveState: async () => undefined,
              onSaveTimingState: async () => undefined,
            },
            {
              resolveGameFromState,
              removeGameFromQueue,
              splitDropsForSelectedGame: () => undefined,
              getGameDisplayLabel: (game) => game.name,
              logDebug: () => undefined,
              logWarn: () => undefined,
            },
          ),
      }),
    );
    const queueBefore = [...state.appState.queue];

    const result = await callListener(listener, {
      type: 'SET_SELECTED_GAME',
      payload: { game: requestedCampaign },
    });

    expect(result.response).toEqual({ success: false, error: 'Campaign is no longer available.' });
    expect(state.appState.queue).toEqual(queueBefore);
    expect(state.appState.selectedGame).toBe(existingGame);
  });
});
