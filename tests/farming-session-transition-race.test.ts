import { describe, expect, test } from 'bun:test';
import type {
  FarmingAutomationPersistenceRead,
  FarmingSessionTransitionReceiptV1,
  WatchOwnershipV1,
} from '../src/background/farming-automation-contracts.ts';
import type { FarmingAutomationTwitchSnapshot } from '../src/background/farming-automation-twitch.ts';
import {
  invalidateFarmingSessionEpoch,
  runFarmingSessionMutation,
  runInFarmingSessionCriticalSection,
} from '../src/background/farming-session-revision.ts';
import { createServiceWorkerState, type ServiceWorkerState } from '../src/background/runtime-state.ts';
import {
  type AutomaticFarmingSessionTransitionDependencies,
  type AutomaticFarmingSessionTransitionRequest,
  FarmingSessionTransitionInvariantError,
  transitionAutomaticFarmingSession,
} from '../src/background/session-lifecycle.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';
import {
  createDeferred,
  createExecutionBarrier,
  flushMicrotasks,
} from './support/farming-automation-fixtures.ts';

const incumbent: TwitchGame = {
  id: 'duplicate-game',
  name: 'Duplicate Game',
  imageUrl: 'a.png',
  campaignId: 'campaign-a',
};
const candidate: TwitchGame = {
  id: 'duplicate-game',
  name: 'Duplicate Game',
  imageUrl: 'b.png',
  campaignId: 'campaign-b',
};
const manualWinner: TwitchGame = {
  id: 'manual-game',
  name: 'Manual Game',
  imageUrl: 'manual.png',
  campaignId: 'campaign-manual',
};
const streamer: TwitchStreamer = {
  id: 'streamer-b',
  name: 'channel-b',
  displayName: 'Channel B',
  isLive: true,
};
const drop: TwitchDrop = {
  id: 'drop-b',
  name: 'Reward B',
  gameId: 'duplicate-game',
  gameName: 'Duplicate Game',
  imageUrl: '',
  progress: 10,
  currentMinutes: 5,
  claimed: false,
  campaignId: 'campaign-b',
  acquisitionMethod: 'watch-time',
  rewardKind: 'in-game',
  verificationState: 'unassessed',
};
const fromWatch: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'owned-a',
  expectedChannel: 'channel-a',
};
const toWatch: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 22,
  ownershipToken: 'owned-b',
  expectedChannel: 'channel-b',
};

function createIncumbentState(): ServiceWorkerState {
  const state = createServiceWorkerState();
  state.appState.selectedGame = incumbent;
  state.appState.isRunning = true;
  state.appState.activeStreamer = { ...streamer, name: 'channel-a' };
  state.appState.tabId = 11;
  state.appState.queue = [incumbent];
  return state;
}

function snapshot(): FarmingAutomationTwitchSnapshot {
  return {
    games: [incumbent, candidate],
    drops: [drop],
    campaignDropsByKey: { [gameKey(candidate)]: [drop] },
    campaignChannelsMap: {},
    updatedAt: 1,
  };
}

function request(
  overrides: Partial<AutomaticFarmingSessionTransitionRequest> = {},
): AutomaticFarmingSessionTransitionRequest {
  return {
    attemptId: 'attempt-b',
    transition: 'preemption',
    fromCampaignKey: gameKey(incumbent),
    candidate,
    snapshot: snapshot(),
    watchMode: 'managed-tab',
    expectedFingerprint: 'fingerprint-a',
    ...overrides,
  };
}

type DependencyOverrides = {
  readonly loadReceipt?: AutomaticFarmingSessionTransitionDependencies['loadReceipt'];
  readonly commitTransition?: AutomaticFarmingSessionTransitionDependencies['commitTransition'];
};

function dependenciesFor(
  state: ServiceWorkerState,
  events: string[],
  overrides: DependencyOverrides = {},
): AutomaticFarmingSessionTransitionDependencies {
  return {
    acquireStreamer: async () => {
      events.push('acquire');
      return streamer;
    },
    currentFingerprint: () => 'fingerprint-a',
    loadReceipt: overrides.loadReceipt ?? (async () => ({ kind: 'ready', source: 'missing', value: null })),
    commitTransition:
      overrides.commitTransition ??
      (async (commit) => {
        events.push('commit');
        state.appState = structuredClone(commit.nextAppState);
        state.cachedDropsSnapshot = structuredClone(commit.nextDropsSnapshot);
        events.push('publish');
        return { kind: 'committed' };
      }),
    watch: {
      currentOwnership: () => fromWatch,
      prepare: async () => {
        events.push('prepare');
        return {
          kind: 'prepared',
          watch: {
            target: { gameId: 'duplicate-game', campaignId: 'campaign-b', channelName: 'channel-b' },
            ownership: toWatch,
            health: {
              mode: 'managed-tab',
              isHealthy: true,
              status: 'healthy',
              reason: 'heartbeat',
              consecutiveFailures: 0,
              consecutiveStalls: 0,
              progress: null,
              shouldFallback: false,
              checkedAt: 1,
            },
            promote: () => {
              events.push('promote');
              return { kind: 'promoted', ownership: toWatch, obsolete: fromWatch };
            },
            dispose: async () => {
              events.push('dispose');
            },
          },
        };
      },
      release: async () => ({ kind: 'abandoned-unproven' }),
    },
    now: () => 2_000,
  };
}

function persistedReceipt(): FarmingSessionTransitionReceiptV1 {
  return {
    version: 1,
    attemptId: 'attempt-b',
    transition: 'preemption',
    fromCampaignKey: gameKey(incumbent),
    toCampaignKey: gameKey(candidate),
    toStreamerName: streamer.name,
    committedAt: 2_000,
    sessionRevision: '0',
    fromWatch,
    toWatch,
    cleanup: { kind: 'pending', obsolete: fromWatch },
  };
}

describe('automatic farming session transition races', () => {
  test('supersedes when the Session epoch changes during receipt loading', async () => {
    // Given: an automatic attempt blocked on its first external receipt read.
    const state = createIncumbentState();
    const before = JSON.stringify(state);
    const events: string[] = [];
    const receiptRead =
      createDeferred<FarmingAutomationPersistenceRead<FarmingSessionTransitionReceiptV1 | null>>();
    const transition = transitionAutomaticFarmingSession(
      state,
      request(),
      dependenciesFor(state, events, {
        loadReceipt: async () => receiptRead.promise,
      }),
    );

    // When: a manual Session mutation invalidates the epoch before the read completes.
    invalidateFarmingSessionEpoch(state);
    receiptRead.resolve({ kind: 'ready', source: 'missing', value: null });
    const result = await transition;

    // Then: stale work performs no acquisition, preparation, write, publication, or promotion.
    expect({ result, events, after: JSON.stringify(state) }).toEqual({
      result: { kind: 'unchanged', reason: 'superseded-by-state-change' },
      events: [],
      after: before,
    });
  });

  test('manual mutation before critical-section entry supersedes B', async () => {
    // Given: B is prepared while an earlier Session critical section still owns the FIFO.
    const state = createIncumbentState();
    const events: string[] = [];
    const gate = createExecutionBarrier<void>();
    const blocker = runInFarmingSessionCriticalSection(state, async () => {
      gate.markStarted();
      await gate.promise;
    });
    await gate.started;
    const transition = transitionAutomaticFarmingSession(state, request(), dependenciesFor(state, events));
    await flushMicrotasks();
    expect(events).toEqual(['acquire', 'prepare']);

    // When: a manual mutation invalidates the attempt before B enters the section.
    const manual = runFarmingSessionMutation(state, async () => {
      events.push('manual');
      state.appState.selectedGame = manualWinner;
    });
    gate.release(undefined);
    await blocker;
    const [result] = await Promise.all([transition, manual]);

    // Then: B is disposed without a write and the queued manual mutation is final.
    expect({ result, events, selected: state.appState.selectedGame }).toEqual({
      result: { kind: 'unchanged', reason: 'superseded-by-state-change' },
      events: ['acquire', 'prepare', 'dispose', 'manual'],
      selected: manualWinner,
    });
  });

  test('manual mutation beginning after critical-section entry applies after B', async () => {
    // Given: B entered the Session critical section and is blocked at its durable commit.
    const state = createIncumbentState();
    const events: string[] = [];
    const commitGate = createExecutionBarrier<{ readonly kind: 'committed' }>();
    const transition = transitionAutomaticFarmingSession(
      state,
      request(),
      dependenciesFor(state, events, {
        commitTransition: async (commit) => {
          events.push('commit');
          commitGate.markStarted();
          const result = await commitGate.promise;
          state.appState = structuredClone(commit.nextAppState);
          state.cachedDropsSnapshot = structuredClone(commit.nextDropsSnapshot);
          events.push('publish');
          return result;
        },
      }),
    );
    await commitGate.started;

    // When: a manual mutation starts after B owns the FIFO, then B's commit completes.
    const manual = runFarmingSessionMutation(state, async () => {
      events.push('manual');
      state.appState.selectedGame = manualWinner;
    });
    commitGate.release({ kind: 'committed' });
    const result = await transition;
    await manual;

    // Then: B commits and promotes first; the serialized manual choice is final.
    expect({ kind: result.kind, events, selected: state.appState.selectedGame }).toEqual({
      kind: 'committed',
      events: ['acquire', 'prepare', 'commit', 'publish', 'promote', 'manual'],
      selected: manualWinner,
    });
  });

  test('replays the same attempt and pair without work but rejects another pair', async () => {
    // Given: durable storage already contains this attempt's committed A-to-B receipt.
    const state = createIncumbentState();
    const events: string[] = [];
    const receipt = persistedReceipt();
    const dependencies = dependenciesFor(state, events, {
      loadReceipt: async () => ({ kind: 'ready', source: 'stored', value: receipt }),
    });

    // When: the exact attempt is replayed, then its identity is reused for another pair.
    const replay = await transitionAutomaticFarmingSession(state, request(), dependencies);
    const reused = transitionAutomaticFarmingSession(
      state,
      request({ fromCampaignKey: 'campaign:another-incumbent' }),
      dependencies,
    );

    // Then: replay performs no external work, while pair reuse is an invariant violation.
    expect(replay).toEqual({ kind: 'replayed', receipt });
    await expect(reused).rejects.toBeInstanceOf(FarmingSessionTransitionInvariantError);
    expect(events).toEqual([]);
  });

  test('preserves incumbent and disposes B when the commit adapter rejects', async () => {
    // Given: a viable prepared candidate and a durable commit adapter that rejects.
    const state = createIncumbentState();
    const before = JSON.stringify(state);
    const events: string[] = [];
    const dependencies = dependenciesFor(state, events, {
      commitTransition: async () => {
        events.push('commit');
        throw new DOMException('injected storage rejection');
      },
    });

    // When: the automatic transition reaches the rejecting durable boundary.
    const result = await transitionAutomaticFarmingSession(state, request(), dependencies);

    // Then: B is disposed, A is byte-identical, and no publication or promotion occurs.
    expect({ result, events, after: JSON.stringify(state) }).toEqual({
      result: { kind: 'failed', reason: 'transition-commit-failed' },
      events: ['acquire', 'prepare', 'commit', 'dispose'],
      after: before,
    });
  });
});
