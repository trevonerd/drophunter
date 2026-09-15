import { describe, expect, test } from 'bun:test';
import type {
  FarmingAutomationPersistenceRead,
  FarmingSessionTransitionReceiptV1,
} from '../src/background/farming-automation-contracts.ts';
import {
  invalidateFarmingSessionEpoch,
  runFarmingSessionMutation,
  runInFarmingSessionCriticalSection,
} from '../src/background/farming-session-revision.ts';
import {
  FarmingSessionTransitionInvariantError,
  transitionAutomaticFarmingSession,
} from '../src/background/session-lifecycle.ts';
import {
  createIncumbentState,
  dependenciesFor,
  manualWinner,
  persistedReceipt,
  request,
} from './helpers/farming-session-transition-race.ts';
import {
  createDeferred,
  createExecutionBarrier,
  flushMicrotasks,
} from './support/farming-automation-fixtures.ts';

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

  test('manual mutation during commit prevents stale candidate promotion', async () => {
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

    // Then: the committed candidate is disposed after invalidation and the manual choice is final.
    expect({ kind: result.kind, events, selected: state.appState.selectedGame }).toEqual({
      kind: 'unchanged',
      events: ['acquire', 'prepare', 'commit', 'publish', 'dispose', 'manual'],
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
