import { describe, expect, test } from 'bun:test';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
  type FarmingSessionTransitionReceiptV1,
  type WatchCleanupV1,
  type WatchOwnershipV1,
} from '../src/background/farming-automation-contracts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { reconcileFarmingAutomationRecovery } from '../src/background/farming-automation-recovery.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { transitionAutomaticFarmingSession } from '../src/background/session-lifecycle.ts';
import { createWatchTransportTransition } from '../src/background/watch-transport-transition.ts';
import { gameKey } from '../src/shared/game-selection.ts';
import type { TwitchDrop, TwitchGame, TwitchStreamer } from '../src/types/index.ts';

const gameA: TwitchGame = { id: 'game', name: 'Game', imageUrl: '', campaignId: 'a' };
const gameB: TwitchGame = { id: 'game', name: 'Game', imageUrl: '', campaignId: 'b' };
const gameC: TwitchGame = { id: 'game', name: 'Game', imageUrl: '', campaignId: 'c' };
const watchA: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'token-a',
  expectedChannel: 'channel-a',
};
const watchB: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 22,
  ownershipToken: 'token-b',
  expectedChannel: 'channel-b',
};

function receipt(cleanup: WatchCleanupV1 = { kind: 'not-required' }): FarmingSessionTransitionReceiptV1 {
  return {
    version: 1,
    attemptId: 'attempt-a-b',
    transition: 'preemption',
    fromCampaignKey: gameKey(gameA),
    toCampaignKey: gameKey(gameB),
    toStreamerName: 'channel-b',
    committedAt: 5_000,
    sessionRevision: '0',
    fromWatch: watchA,
    toWatch: watchB,
    cleanup,
  };
}

function createFixture(storedReceipt: FarmingSessionTransitionReceiptV1) {
  const state = createServiceWorkerState();
  state.appState.selectedGame = gameB;
  state.appState.isRunning = true;
  state.appState.manualWatchState = 'eligible-manual';
  state.appState.nextAutomationCheckAt = 99_000;
  const storage = createInMemoryFarmingAutomationStorage();
  storage.seedLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY, storedReceipt);
  const persistence = createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => '0',
    broadcast: () => undefined,
  });
  const activityAttempts: string[] = [];
  const cleanupChecks: WatchOwnershipV1[] = [];
  const recover = () =>
    reconcileFarmingAutomationRecovery({
      persistence,
      currentCampaignKey: () => (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null),
      async repairActivity(currentReceipt) {
        if (!activityAttempts.includes(currentReceipt.attemptId))
          activityAttempts.push(currentReceipt.attemptId);
        return { kind: 'written' };
      },
      watch: {
        async release(ownership) {
          cleanupChecks.push(ownership);
          return { kind: 'abandoned-unproven' };
        },
      },
      now: () => 8_000,
    });
  return { state, storage, persistence, recover, activityAttempts, cleanupChecks };
}

describe('Farming automation receipt recovery', () => {
  test.each([
    ['repairs committed receipt without starting B again', true],
    ['preserves a manual stop while repairing historical effects', false],
  ] as const)('%s', async (_name, running) => {
    // Given: B and its receipt were committed, but facts, activity, and projections were not.
    const fixture = createFixture(receipt());
    fixture.state.appState.isRunning = running;

    // When: two reconstructed evaluations reconcile the same durable receipt.
    const first = await fixture.recover();
    const second = await fixture.recover();
    const facts = await fixture.persistence.loadFacts();

    // Then: history and projections are repaired idempotently without transport work.
    expect(first).toEqual({ kind: 'ready', receipt: receipt(), matchedCommittedTarget: true });
    expect(second).toEqual(first);
    expect(facts).toMatchObject({
      kind: 'ready',
      value: {
        lastPreemption: {
          attemptId: 'attempt-a-b',
          fromCampaignKey: gameKey(gameA),
          toCampaignKey: gameKey(gameB),
          committedAt: 5_000,
          sessionRevision: '0',
        },
      },
    });
    expect(fixture.activityAttempts).toEqual(['attempt-a-b']);
    expect(fixture.cleanupChecks).toEqual([]);
    expect(
      fixture.storage
        .getLocalSetPayloads()
        .filter((payload) => FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY in payload),
    ).toEqual([]);
    expect({
      running: fixture.state.appState.isRunning,
      manual: fixture.state.appState.manualWatchState,
      deadline: fixture.state.appState.nextAutomationCheckAt,
    }).toEqual({
      running,
      manual: 'inactive',
      deadline: null,
    });
  });

  test('abandons unproven cleanup before a later transition', async () => {
    // Given: current B has a pending obsolete A receipt whose browser proof is stale.
    const fixture = createFixture(receipt({ kind: 'pending', obsolete: watchA }));
    let prepareCount = 0;
    const watch = createWatchTransportTransition({
      currentOwnership: watchB,
      prepareManaged: async () => {
        prepareCount += 1;
        return {
          target: { gameId: 'game', campaignId: 'c', channelName: 'channel-c' },
          ownership: {
            kind: 'managed-tab',
            tabId: 33,
            ownershipToken: 'token-c',
            expectedChannel: 'channel-c',
          },
          health: {
            mode: 'managed-tab',
            isHealthy: true,
            status: 'healthy',
            reason: 'heartbeat',
            consecutiveFailures: 0,
            consecutiveStalls: 0,
            progress: null,
            shouldFallback: false,
            checkedAt: 9_000,
          },
          dispose: async () => undefined,
        };
      },
      prepareTabless: async () => null,
      release: async () => ({ kind: 'abandoned-unproven' }),
    });
    const dropC: TwitchDrop = {
      id: 'drop-c',
      name: 'Drop C',
      gameId: 'game',
      gameName: 'Game',
      imageUrl: '',
      progress: 0,
      currentMinutes: 0,
      claimed: false,
      campaignId: 'c',
      acquisitionMethod: 'watch-time',
      rewardKind: 'in-game',
      verificationState: 'unassessed',
    };
    const streamerC: TwitchStreamer = { id: 'streamer-c', name: 'channel-c', displayName: 'C', isLive: true };
    const transition = () =>
      transitionAutomaticFarmingSession(
        fixture.state,
        {
          attemptId: 'attempt-b-c',
          transition: 'preemption',
          fromCampaignKey: gameKey(gameB),
          candidate: gameC,
          snapshot: {
            games: [gameC],
            drops: [dropC],
            campaignDropsByKey: { [gameKey(gameC)]: [dropC] },
            campaignChannelsMap: { c: ['channel-c'] },
            updatedAt: 9_000,
          },
          watchMode: 'managed-tab',
          expectedFingerprint: 'fingerprint',
        },
        {
          acquireStreamer: async () => streamerC,
          currentFingerprint: () => 'fingerprint',
          loadReceipt: () => fixture.persistence.loadReceipt(),
          commitTransition: (commit) => fixture.persistence.commitTransition(commit),
          watch,
          now: () => 9_000,
        },
      );

    // When: a transition is attempted before and after recovery acknowledges stale proof.
    const blocked = await transition();
    const recovered = await fixture.recover();
    const committed = await transition();
    const stored = await fixture.persistence.loadReceipt();

    // Then: no preparation occurs while pending; recovery is non-destructive; C preserves B cleanup proof.
    expect({ blocked, recovery: recovered.kind, committed: committed.kind, prepareCount }).toEqual({
      blocked: { kind: 'failed', reason: 'transition-commit-failed' },
      recovery: 'ready',
      committed: 'committed',
      prepareCount: 1,
    });
    expect(recovered).toMatchObject({
      kind: 'ready',
      receipt: { cleanup: { kind: 'abandoned-unproven', acknowledgedAt: 8_000 } },
    });
    expect(fixture.cleanupChecks).toEqual([watchA]);
    expect(stored).toMatchObject({
      kind: 'ready',
      value: { cleanup: { kind: 'pending', obsolete: watchB } },
    });
  });

  test.each(['facts', 'receipt'] as const)('fails closed on unknown %s version', async (unknownRecord) => {
    // Given: one unsupported durable record and otherwise valid recovery data.
    const fixture = createFixture(receipt({ kind: 'pending', obsolete: watchA }));
    const unknown = { version: 2, evidence: unknownRecord };
    fixture.storage.seedLocal(
      unknownRecord === 'facts'
        ? FARMING_AUTOMATION_FACTS_STORAGE_KEY
        : FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
      unknown,
    );
    const before = structuredClone(fixture.state.appState);

    // When: recovery encounters the unsupported version.
    const result = await fixture.recover();

    // Then: it preserves raw evidence and performs no activity, cleanup, or Session mutation.
    expect(result).toEqual({ kind: 'failed', reason: 'persistence-failed' });
    expect(
      fixture.storage.getLocal(
        unknownRecord === 'facts'
          ? FARMING_AUTOMATION_FACTS_STORAGE_KEY
          : FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
      ),
    ).toEqual(unknown);
    expect({
      activity: fixture.activityAttempts,
      cleanup: fixture.cleanupChecks,
      state: fixture.state.appState,
    }).toEqual({ activity: [], cleanup: [], state: before });
  });
});
