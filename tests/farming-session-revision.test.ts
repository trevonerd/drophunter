import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createFarmingSession, type FarmingSessionAdapters } from '../src/background/farming-session.ts';
import {
  currentFarmingSessionEpoch,
  invalidateFarmingSessionEpoch,
  isFarmingSessionEpochCurrent,
  runInFarmingSessionCriticalSection,
} from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchGame } from '../src/types/index.ts';
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
  return {
    getInitPromise: () => null,
    trackActivity,
    ensureTwitchSession: async () => null,
    fetchDropsSnapshotFromApi: async () => null,
    fetchInventorySnapshotFromApi: async () => null,
    fetchDirectoryStreamersFromApi: async () => Object.assign([], { languageFilterApplied: true }),
    fetchStreamContext: async () => null,
    resolveCategorySlug: async () => '',
    openForegroundChannel: async () => undefined,
    enforcePlaybackPolicyOnStreamTab: async () => undefined,
    attemptPlaybackSelfHeal: async () => undefined,
    attemptAutoClaimChannelPointsBonus: async () => false,
    closeManagedTabIfSafe: async () => true,
    clearManagedTabOwnership: () => undefined,
    openMonitorDashboardWindow: async () => undefined,
    sendAlert: async () => undefined,
    notify: async () => undefined,
    saveState: async () => undefined,
    saveTimingState: async () => undefined,
    broadcastStateUpdate: () => undefined,
    monitorAutoOpenDelayMs: 0,
  };
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
    expect(state.appState.isPaused).toBe(false);
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

  test('queues a manual mutation behind the active critical section', async () => {
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
    expect(activityCalls).toBe(0);
    expect(state.appState.isPaused).toBe(false);
    releaseCriticalSection.resolve(undefined);
    await occupied;
    await activityStarted.promise;
    releaseActivity.resolve(undefined);
    await mutation;
    expect(state.appState.isPaused).toBe(true);
  });
});
