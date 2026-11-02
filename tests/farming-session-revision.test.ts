import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession, type FarmingSessionAdapters } from '../src/background/farming-session.ts';
import {
  currentFarmingSessionEpoch,
  invalidateFarmingSessionEpoch,
  isFarmingSessionEpochCurrent,
  runInFarmingSessionCriticalSection,
} from '../src/background/farming-session-revision.ts';
import { reconcileFarmingSessionTargets } from '../src/background/farming-session-targets.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { bindCampaignEvidenceAccount } from '../src/background/session-account-evidence.ts';
import type { AppState, TwitchGame } from '../src/types/index.ts';
import { createFarmingSessionAdapters, createGame, createStreamer } from './fixtures/queue-management.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';
import { createDeferred, flushMicrotasks } from './support/farming-automation-fixtures.ts';

let chromeMocks: ChromeMocks;

beforeAll(() => {
  chromeMocks = setupChromeMocks();
});

afterAll(() => {
  chromeMocks.teardown();
});

function createAdapters(trackActivity: FarmingSessionAdapters['trackActivity']): FarmingSessionAdapters {
  return createFarmingSessionAdapters({
    trackActivity,
    resolveCategorySlug: async () => '',
  });
}

type FarmingSession = ReturnType<typeof createFarmingSession>;

type MutationCase = {
  readonly name: string;
  readonly run: (session: FarmingSession) => Promise<unknown>;
};

function unavailableGame(): TwitchGame {
  return {
    id: 'game-1',
    name: 'Game',
    imageUrl: '',
    campaignId: 'campaign-1',
  };
}

const mutationCases = [
  { name: 'start', run: (session) => session.handleStartFarming({}) },
  { name: 'select', run: (session) => session.handleSetSelectedGame({ game: unavailableGame() }) },
  { name: 'add queue entry', run: (session) => session.handleAddToQueue({}) },
  { name: 'remove queue entry', run: (session) => session.handleRemoveFromQueue({}) },
  { name: 'reorder queue', run: (session) => session.handleReorderQueue({}) },
  { name: 'clear queue', run: (session) => session.handleClearQueue() },
  { name: 'pause', run: (session) => session.handlePauseFarming() },
  { name: 'resume', run: (session) => session.handleResumeFarming() },
  { name: 'stop', run: (session) => session.handleStopFarming() },
] satisfies readonly MutationCase[];

describe('farming session revision authority', () => {
  test('Pause freezes both incumbent and pending observation before clearing transient navigation', async () => {
    const state = createServiceWorkerState();
    const incumbent = createGame({ campaignId: 'incumbent' });
    const candidate = createGame({ campaignId: 'candidate' });
    Object.assign(state.appState, {
      isRunning: true,
      selectedGame: incumbent,
      pendingWatchTarget: { game: candidate, channelName: 'next' },
      queue: [incumbent, candidate],
    });
    for (const key of ['campaign:incumbent', 'campaign:candidate'])
      state.appState.queueEntryMetadataByKey[key] = {
        source: 'manual',
        reason: 'user-added',
        addedAt: 1,
        watchAttempt: { channelName: 'next', observedAt: 1 },
      };
    const activity = createDeferred<void>();
    let now = 100;
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        now: () => now,
        trackActivity: () => activity.promise,
      }),
    );
    const paused = session.handlePauseFarming();
    now = 200;
    activity.resolve();
    await paused;
    expect(state.appState.pendingWatchTarget).toBeNull();
    expect(
      Object.values(state.appState.queueEntryMetadataByKey).map(
        (metadata) => metadata.watchAttempt?.suspendedAt,
      ),
    ).toEqual([100, 100]);
  });

  test.each(['stop', 'pause'] as const)('Play supersedes %s issued in the same turn', async (action) => {
    const state = createServiceWorkerState();
    const game = createGame();
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      selectedGame: game,
      queue: [game],
    });
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: {
          prepare: async () => ({ kind: 'failed', reason: 'candidate-unavailable' }),
          start: async () => ({ kind: 'cancelled' }),
          tick: async () => {
            throw new Error('Unexpected tick');
          },
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
    try {
      const pending = action === 'stop' ? session.handleStopFarming() : session.handlePauseFarming();
      await session.handleStartFarming({ game });
      await pending;
      expect(state.appState).toMatchObject({
        isRunning: true,
        isPaused: false,
        lastStopReason: null,
        manualQueueAuthorized: true,
      });
    } finally {
      session.stopMonitoring();
    }
  });

  test('Resume persists intent and wakes monitoring without starting playback or clearing cooldowns', async () => {
    const state = createServiceWorkerState();
    const game = createGame();
    const deadline = Date.now() + 600_000;
    Object.assign(state.appState, {
      isRunning: true,
      isPaused: true,
      manualQueueAuthorized: true,
      selectedGame: game,
      queue: [game],
      activeStreamer: createStreamer(),
      recoveryReason: 'twitch-network',
      recoveryBackoffUntil: deadline,
    });
    state.apiBackoffUntil = deadline;
    state.recoveryBackoffUntil = deadline;
    let starts = 0;
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        watchTransport: {
          start: async () => {
            starts++;
            return { kind: 'cancelled' };
          },
          tick: async () => {
            throw new Error('Unexpected playback tick');
          },
          stop: async () => {},
          setPreference: async () => {},
        },
      }),
    );
    try {
      await session.handleResumeFarming();
      expect(starts).toBe(0);
      expect(state.appState.isPaused).toBe(false);
      expect(state.appState.recoveryReason).toBe('twitch-network');
      expect(state.recoveryBackoffUntil).toBe(deadline);
      expect(state.apiBackoffUntil).toBe(deadline);
      expect(chromeMocks.chrome.alarms._created).toContainEqual({
        name: 'dropCheck',
        info: { when: expect.any(Number), periodInMinutes: 1 },
      });
    } finally {
      session.stopMonitoring();
    }
  });

  test('Stop persists its manual block while transport cleanup is still pending', async () => {
    const state = createServiceWorkerState();
    Object.assign(state.appState, {
      isRunning: true,
      manualQueueAuthorized: true,
      autoStartFavoriteGames: true,
    });
    const cleanup = createDeferred<void>();
    const snapshots: AppState[] = [];
    const session = createFarmingSession(
      state,
      createFarmingSessionAdapters({
        saveState: async (next) => {
          snapshots.push(structuredClone(next.appState));
        },
        watchTransport: {
          start: async () => ({ kind: 'cancelled' }),
          tick: async () => {
            throw new Error('Unexpected playback tick');
          },
          stop: () => cleanup.promise,
          setPreference: async () => {},
        },
      }),
    );
    const stopping = session.handleStopFarming();
    try {
      expect(state.appState.lastStopReason).toBe('user-stop');
      await flushMicrotasks();
      expect(snapshots.length).toBeGreaterThan(0);
      expect(
        snapshots.every(
          (saved) => !saved.isRunning && !saved.manualQueueAuthorized && saved.lastStopReason === 'user-stop',
        ),
      ).toBe(true);
    } finally {
      cleanup.resolve();
      await stopping;
    }
  });

  test.each(['stop', 'pause', 'clear'] as const)(
    'new Play supersedes a pending %s transport cleanup',
    async (action) => {
      const state = createServiceWorkerState();
      const previous = createGame({ campaignId: 'previous' });
      const next = createGame({ campaignId: 'next' });
      Object.assign(state.appState, {
        isRunning: true,
        manualQueueAuthorized: true,
        selectedGame: previous,
        queue: [previous, next],
        availableGames: [previous, next],
      });
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const session = createFarmingSession(
        state,
        createFarmingSessionAdapters({
          watchTransport: {
            prepare: async () => ({ kind: 'failed', reason: 'candidate-unavailable' }),
            start: async () => ({ kind: 'cancelled' }),
            tick: async () => {
              throw new Error('No tick expected');
            },
            setPreference: async () => {},
            stop: async () => {
              entered.resolve();
              await release.promise;
            },
          },
        }),
      );
      const pending =
        action === 'stop'
          ? session.handleStopFarming()
          : action === 'pause'
            ? session.handlePauseFarming()
            : session.handleClearQueue();
      await entered.promise;
      expect((await session.handleStartQueuedCampaign('campaign:next')).success).toBe(true);
      release.resolve();
      await pending;
      expect(state.appState.isRunning).toBe(true);
      expect(state.appState.isPaused).toBe(false);
      expect(state.appState.manualQueueAuthorized).toBe(true);
      expect(state.appState.selectedGame?.campaignId).toBe('next');
      expect(state.appState.farmingSessionTargets['campaign:next']).toBeDefined();
      session.stopMonitoring();
    },
  );

  test('changing Twitch account invalidates acquired target evidence while retaining authorization', async () => {
    const state = createServiceWorkerState();
    const game = createGame({ campaignId: 'account-target', allDropsCompleted: true });
    state.appState.campaignEvidenceUserId = 'account-A';
    state.appState.manualQueueAuthorized = true;
    state.appState.queue = [game];
    state.appState.selectedGame = game;
    state.appState.farmingSessionTargets['campaign:account-target'] = { game, acquired: true };
    await bindCampaignEvidenceAccount(state, 'account-B');
    reconcileFarmingSessionTargets(state);
    expect(state.appState.farmingSessionTargets['campaign:account-target']?.acquired).toBe(false);
    expect(state.appState.manualQueueAuthorized).toBe(true);
    expect(state.appState.queue[0]?.campaignId).toBe(game.campaignId);
  });

  for (const mutationCase of mutationCases) {
    test(`invalidates synchronously for ${mutationCase.name}`, async () => {
      // Given
      const state = createServiceWorkerState();
      const releaseActivity = createDeferred<void>();
      const session = createFarmingSession(
        state,
        createAdapters(async () => {
          await releaseActivity.promise;
        }),
      );
      const capturedEpoch = currentFarmingSessionEpoch(state);

      // When
      const mutation = mutationCase.run(session);
      const epochBeforeActivityRelease = currentFarmingSessionEpoch(state);
      releaseActivity.resolve(undefined);
      await mutation;

      // Then
      expect(epochBeforeActivityRelease).toBe(capturedEpoch + 1);
    });
  }

  test('invalidates synchronously before activity awaits', async () => {
    // Given
    const state = createServiceWorkerState();
    const activityStarted = createDeferred<void>();
    const releaseActivity = createDeferred<void>();
    const session = createFarmingSession(
      state,
      createAdapters(async () => {
        activityStarted.resolve(undefined);
        await releaseActivity.promise;
      }),
    );
    const capturedEpoch = currentFarmingSessionEpoch(state);

    // When
    const mutation = session.handlePauseFarming();

    // Then
    expect(isFarmingSessionEpochCurrent(state, capturedEpoch)).toBe(false);
    await activityStarted.promise;
    expect(state.appState.isPaused).toBe(true);
    releaseActivity.resolve(undefined);
    await mutation;
  });

  test('runs critical sections in FIFO order', async () => {
    // Given
    const state = createServiceWorkerState();
    const releaseFirst = createDeferred<void>();
    const events: string[] = [];

    // When
    const first = runInFarmingSessionCriticalSection(state, async () => {
      events.push('first-started');
      await releaseFirst.promise;
      events.push('first-finished');
      return 1;
    });
    const second = runInFarmingSessionCriticalSection(state, async () => {
      events.push('second-started');
      return 2;
    });
    await flushMicrotasks();

    // Then
    expect(events).toEqual(['first-started']);
    releaseFirst.resolve(undefined);
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(events).toEqual(['first-started', 'first-finished', 'second-started']);
  });

  test('does not block manual controls on debounced timing persistence', async () => {
    const state = createServiceWorkerState();
    state.appState.isRunning = true;
    const timingSave = createDeferred<void>();
    const adapters = createAdapters(async () => undefined);
    const session = createFarmingSession(state, {
      ...adapters,
      saveTimingState: () => timingSave.promise,
    });

    await session.handlePauseFarming();
    expect(state.appState.isPaused).toBe(true);

    await session.handleResumeFarming();
    expect(state.appState.isPaused).toBe(false);

    timingSave.resolve(undefined);
  });

  test('keeps revision state ephemeral and isolated per session state', async () => {
    // Given
    const state = createServiceWorkerState();
    const independentState = createServiceWorkerState();
    const serializedState = JSON.stringify(state);

    // When
    invalidateFarmingSessionEpoch(state);
    await runInFarmingSessionCriticalSection(state, async () => undefined);

    // Then
    expect({
      persistedState: JSON.stringify(state),
      independentEpoch: currentFarmingSessionEpoch(independentState),
    }).toEqual({ persistedState: serializedState, independentEpoch: 0 });
  });

  test('Pause interrupts the active critical section immediately', async () => {
    // Given
    const state = createServiceWorkerState();
    const criticalSectionStarted = createDeferred<void>();
    const releaseCriticalSection = createDeferred<void>();
    const activityStarted = createDeferred<void>();
    const releaseActivity = createDeferred<void>();
    let activityCalls = 0;
    const occupied = runInFarmingSessionCriticalSection(state, async () => {
      criticalSectionStarted.resolve(undefined);
      await releaseCriticalSection.promise;
    });
    await criticalSectionStarted.promise;
    const session = createFarmingSession(
      state,
      createAdapters(async () => {
        activityCalls += 1;
        activityStarted.resolve(undefined);
        await releaseActivity.promise;
      }),
    );
    const capturedEpoch = currentFarmingSessionEpoch(state);

    // When
    const mutation = session.handlePauseFarming();
    await flushMicrotasks();

    // Then
    expect(isFarmingSessionEpochCurrent(state, capturedEpoch)).toBe(false);
    expect(activityCalls).toBe(1);
    expect(state.appState.isPaused).toBe(true);
    releaseCriticalSection.resolve(undefined);
    await occupied;
    await activityStarted.promise;
    releaseActivity.resolve(undefined);
    await mutation;
    expect(state.appState.isPaused).toBe(true);
  });
});
