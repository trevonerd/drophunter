import { describe, expect, mock, test } from 'bun:test';
import {
  type HandleSetSelectedGameCallbacks,
  type HandleSetSelectedGameDeps,
  handleSetSelectedGame,
} from '../src/background/drops-tick-selection.ts';
import { removeGameFromQueue, resolveGameFromState } from '../src/background/queue-operations.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchGame } from '../src/types';

const active: TwitchGame = { id: 'game', campaignId: 'active', name: 'Game', imageUrl: '' };
const target: TwitchGame = { ...active, campaignId: 'target' };
const terminalCampaigns = [
  { ...target, allDropsCompleted: true },
  { ...target, rewardSummary: { completion: 'all-acquired', remainderReasons: [] } },
  {
    ...target,
    rewardSummary: { completion: 'farming-complete', remainderReasons: ['subscription-required'] },
  },
  { ...target, expiresInMs: 0 },
] satisfies TwitchGame[];

function setup(game: TwitchGame, running = true) {
  const state = createServiceWorkerState();
  state.appState.isRunning = running;
  state.appState.selectedGame = active;
  state.appState.availableGames = [active, game];
  state.appState.queue = [active, game];
  const callbacks = {
    onTrackActivity: mock(async () => {}),
    onEnsureWorkspace: mock(async () => {}),
    onRefreshDropsData: mock(async () => {}),
    onOpenBestStreamer: mock(async () => true),
    onSaveState: mock(async () => {}),
    onSaveTimingState: mock(async () => {}),
  } satisfies HandleSetSelectedGameCallbacks;
  const deps = {
    resolveGameFromState,
    removeGameFromQueue,
    splitDropsForSelectedGame: () => {},
    getGameDisplayLabel: (selected: TwitchGame) => selected.name,
    logDebug: () => {},
    logWarn: () => {},
  } satisfies HandleSetSelectedGameDeps;
  return { state, callbacks, deps };
}

describe('campaign selection completion guard', () => {
  test.each(
    terminalCampaigns,
  )('rejects terminal campaign before changing a running session: %j', async (game) => {
    const { state, callbacks, deps } = setup(game);
    const queue = [...state.appState.queue];

    const result = await handleSetSelectedGame(state, { game: target }, callbacks, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(state.appState.selectedGame).toEqual(active);
    expect(state.appState.queue).toEqual(queue);
    expect(callbacks.onEnsureWorkspace).not.toHaveBeenCalled();
    expect(callbacks.onRefreshDropsData).not.toHaveBeenCalled();
    expect(callbacks.onOpenBestStreamer).not.toHaveBeenCalled();
  });

  test.each(terminalCampaigns)('allows idle inspection of a terminal campaign: %j', async (game) => {
    const { state, callbacks, deps } = setup(game, false);

    const result = await handleSetSelectedGame(state, { game: target }, callbacks, deps);

    expect(result.success).toBe(true);
    expect(state.appState.selectedGame?.campaignId).toBe('target');
    expect(callbacks.onRefreshDropsData).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenBestStreamer).not.toHaveBeenCalled();
  });

  test.each(terminalCampaigns)('does not open a streamer when refresh proves terminal: %j', async (game) => {
    const { state, callbacks, deps } = setup(target);
    callbacks.onRefreshDropsData.mockImplementation(async () => {
      state.appState.availableGames = [active, game];
    });

    await handleSetSelectedGame(state, { game: target }, callbacks, deps);

    expect(callbacks.onOpenBestStreamer).not.toHaveBeenCalled();
    expect(callbacks.onSaveState).toHaveBeenCalledTimes(1);
    expect(callbacks.onSaveTimingState).toHaveBeenCalledTimes(1);
  });

  test('does not open a streamer when refresh proves only the selected projection complete', async () => {
    const { state, callbacks, deps } = setup(target);
    callbacks.onRefreshDropsData.mockImplementation(async () => {
      state.appState.selectedGame = { ...target, allDropsCompleted: true };
    });

    await handleSetSelectedGame(state, { game: target }, callbacks, deps);

    expect(callbacks.onOpenBestStreamer).not.toHaveBeenCalled();
  });

  test('allows paused inspection without promoting the campaign in the queue', async () => {
    const game = { ...target, allDropsCompleted: true };
    const { state, callbacks, deps } = setup(game);
    state.appState.isPaused = true;
    const queue = [...state.appState.queue];

    const result = await handleSetSelectedGame(state, { game: target }, callbacks, deps);

    expect(result.success).toBe(true);
    expect(state.appState.selectedGame?.campaignId).toBe('target');
    expect(state.appState.queue).toEqual(queue);
    expect(callbacks.onOpenBestStreamer).not.toHaveBeenCalled();
  });

  test('opens the selected farmable campaign even when another campaign of the same game is complete', async () => {
    const { state, callbacks, deps } = setup(target);
    state.appState.availableGames = [{ ...active, allDropsCompleted: true }, target];

    const result = await handleSetSelectedGame(state, { game: target }, callbacks, deps);

    expect(result.success).toBe(true);
    expect(state.appState.selectedGame?.campaignId).toBe('target');
    expect(state.appState.queue[0]?.campaignId).toBe('target');
    expect(callbacks.onOpenBestStreamer).toHaveBeenCalledTimes(1);
  });
});
