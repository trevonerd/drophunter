import { describe, expect, test } from 'bun:test';
import { setGameFavorite } from '../src/background/favorite-games.ts';
import {
  advanceQueueIfCompleted,
  handleStartFarming,
  skipCurrentGameAndAdvanceQueue,
} from '../src/background/session-lifecycle.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import {
  campaign,
  createContinuationProbe,
  createManualQueue,
  createQueueState,
  reward,
  setAutomaticCompletion,
  setFarmableDrops,
} from './support/v4-queue-continuation.ts';

describe('v4 queue continuation authorization', () => {
  test('keeps manually added campaigns idle after an automatic favorite completes without Start', async () => {
    const [manualA, manualB, automaticC] = ['A', 'B', 'C'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, manualB, automaticC];
    await createManualQueue(state, [manualA, manualB]);
    setAutomaticCompletion(state, automaticC, [automaticC, manualA, manualB]);
    const probe = createContinuationProbe(state, manualA);
    const advanced = await advanceQueueIfCompleted(state, probe.options);

    expect({
      advanced,
      opened: probe.opened(),
      queue: state.appState.queue.map(gameKey),
      selected: state.appState.selectedGame,
    }).toEqual({
      advanced: false,
      opened: 0,
      queue: [gameKey(manualA), gameKey(manualB)],
      selected: null,
    });
  });

  test('keeps the manual tail idle when a manually added campaign is later starred and auto-started', async () => {
    const [manualA, manualB, starredC] = ['A', 'B', 'C'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, manualB, starredC];
    await createManualQueue(state, [manualA, manualB, starredC]);
    setGameFavorite(state.appState, starredC, true, 10);
    setAutomaticCompletion(state, starredC, [starredC, manualA, manualB], { preserveQueueSource: true });
    const probe = createContinuationProbe(state, manualA);
    const advanced = await advanceQueueIfCompleted(state, probe.options);

    expect({
      advanced,
      opened: probe.opened(),
      origin: state.appState.farmingSessionOrigin,
      queue: state.appState.queue.map(gameKey),
    }).toEqual({
      advanced: false,
      opened: 0,
      origin: null,
      queue: [gameKey(manualA), gameKey(manualB)],
    });
  });

  test('resumes the authorized manual queue when an automatic favorite preemption completes', async () => {
    const [manualA, manualB, automaticC] = ['A', 'B', 'C'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, manualB, automaticC];
    setFarmableDrops(state, manualA);
    await createManualQueue(state, [manualA, manualB]);
    await handleStartFarming(state, { game: manualA });
    setAutomaticCompletion(state, automaticC, [automaticC, manualA, manualB]);
    state.appState.manualQueueAuthorized = true;
    const probe = createContinuationProbe(state, manualA);
    const advanced = await advanceQueueIfCompleted(state, probe.options);

    expect({
      advanced,
      opened: probe.opened(),
      queue: state.appState.queue.map(gameKey),
      selected: state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null,
    }).toEqual({
      advanced: true,
      opened: 1,
      queue: [gameKey(manualA), gameKey(manualB)],
      selected: gameKey(manualA),
    });
  });

  test('clears Start authorization on natural completion so a later manual Add stays idle', async () => {
    const [manualA, manualD] = ['A', 'D'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, manualD];
    state.appState.manualQueueAuthorized = true;
    state.appState.isRunning = true;
    state.appState.selectedGame = manualA;
    state.appState.queue = [manualA];
    state.appState.allDrops = [reward(manualA, true)];
    const session = await createManualQueue(state, []);
    await advanceQueueIfCompleted(state);
    const addResult = await session.handleAddToQueue({ game: manualD });

    expect({
      addResult,
      running: state.appState.isRunning,
      authorized: state.appState.manualQueueAuthorized,
      queue: state.appState.queue.map(gameKey),
    }).toEqual({
      addResult: { success: true, added: true, game: manualD, queueLength: 1 },
      running: false,
      authorized: false,
      queue: [gameKey(manualD)],
    });
  });

  test('retains a stalled blocked campaign at the tail when it has no successor', async () => {
    const manualA = campaign('A');
    const state = createQueueState();
    state.appState.isRunning = true;
    state.appState.manualQueueAuthorized = true;
    state.appState.selectedGame = manualA;
    state.appState.queue = [manualA];
    state.appState.stalledCampaignBlocksByKey = {
      [gameKey(manualA)]: {
        blockedAt: 1,
        rotationAttempts: 3,
        eligibleStreamerNames: ['old-channel'],
        rewardProgressByKey: {},
      },
    };
    await skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', {
      onStopFarmingSession: async () => undefined,
    });

    expect({
      authorized: state.appState.manualQueueAuthorized,
      queue: state.appState.queue.map(gameKey),
    }).toEqual({ authorized: false, queue: [gameKey(manualA)] });
  });

  test('does not continue into an unauthorized manual tail after a skip', async () => {
    const [manualA, automaticC] = ['A', 'C'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, automaticC];
    setAutomaticCompletion(state, automaticC, [automaticC, manualA]);
    let opened = 0;
    let stopped = 0;
    await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', {
      onRefreshDropsData: async () => setFarmableDrops(state, manualA),
      onOpenStreamer: async () => {
        opened += 1;
        return true;
      },
      onStopFarmingSession: async () => {
        stopped += 1;
        state.appState.isRunning = false;
        state.appState.selectedGame = null;
      },
    });

    expect({
      opened,
      stopped,
      queue: state.appState.queue.map(gameKey),
      selected: state.appState.selectedGame,
    }).toEqual({
      opened: 0,
      stopped: 0,
      queue: [gameKey(automaticC), gameKey(manualA)],
      selected: automaticC,
    });
    expect(state.appState.manualQueueAuthorized).toBe(false);
    expect(state.appState.recoveryReason).toBe('no-streamers');
  });

  test('does not continue into an unauthorized manual tail after the active campaign expires', async () => {
    const [manualA, automaticC] = ['A', 'C'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, automaticC];
    setAutomaticCompletion(state, automaticC, [automaticC, manualA]);
    state.appState.allDrops = [];
    state.previousAllDropsCount = 1;
    const probe = createContinuationProbe(state, manualA);
    const advanced = await advanceQueueIfCompleted(state, probe.options);

    expect({
      advanced,
      opened: probe.opened(),
      queue: state.appState.queue.map(gameKey),
      selected: state.appState.selectedGame,
    }).toEqual({ advanced: false, opened: 0, queue: [gameKey(manualA)], selected: null });
  });

  test('keeps an unauthorized manual tail idle when automatic start is disabled during a favorite session', async () => {
    const [manualA, automaticC] = ['A', 'C'].map(campaign);
    const state = createQueueState();
    state.appState.availableGames = [manualA, automaticC];
    state.appState.autoStartFavoriteGames = false;
    setAutomaticCompletion(state, automaticC, [automaticC, manualA]);
    const probe = createContinuationProbe(state, manualA);
    const advanced = await advanceQueueIfCompleted(state, probe.options);

    expect({
      advanced,
      opened: probe.opened(),
      queue: state.appState.queue.map(gameKey),
      selected: state.appState.selectedGame,
    }).toEqual({ advanced: false, opened: 0, queue: [gameKey(manualA)], selected: null });
  });
});
