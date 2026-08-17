import { describe, expect, test } from 'bun:test';
import { DROPS_SNAPSHOT_CACHE_KEY } from '../src/background/constants.ts';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
  type FarmingSessionTransitionReceiptV1,
} from '../src/background/farming-automation-contracts.ts';
import { createInitialFarmingAutomationFacts } from '../src/background/farming-automation-facts.ts';
import {
  createChromeFarmingAutomationPersistence,
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import type { TwitchDrop, TwitchGame } from '../src/types/index.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

function persistenceFor(
  storage: ReturnType<typeof createInMemoryFarmingAutomationStorage>,
  state = createServiceWorkerState(),
  broadcast: (appState: typeof state.appState) => void = () => undefined,
) {
  return createInMemoryFarmingAutomationPersistence({
    state,
    storage,
    getSessionRevision: () => 'revision-1',
    broadcast,
  });
}

function transitionReceipt(): FarmingSessionTransitionReceiptV1 {
  return {
    version: 1,
    attemptId: 'attempt-a-b',
    transition: 'preemption',
    fromCampaignKey: 'campaign-a',
    toCampaignKey: 'campaign-b',
    toStreamerName: 'streamer-b',
    committedAt: 1_750_000_000_000,
    sessionRevision: 'revision-1',
    fromWatch: { kind: 'tabless', targetKey: 'campaign-a:streamer-a' },
    toWatch: { kind: 'tabless', targetKey: 'campaign-b:streamer-b' },
    cleanup: { kind: 'not-required' },
  };
}

function game(id: string, campaignId: string): TwitchGame {
  return { id, campaignId, name: id, imageUrl: `https://example.test/${id}.jpg` };
}

function drop(id: string, campaignId: string): TwitchDrop {
  return {
    id,
    campaignId,
    name: id,
    gameId: id,
    gameName: id,
    imageUrl: `https://example.test/${id}.jpg`,
    progress: 0,
    currentMinutes: 0,
    claimed: false,
    acquisitionMethod: 'watch-time',
    rewardKind: 'in-game',
    verificationState: 'unassessed',
  };
}

describe('Farming automation persistence', () => {
  test.each([
    ['worker reconstruction', false, 'stored', true],
    ['browser restart', true, 'missing', false],
  ] as const)('round-trips valid V1 records across %s', async (_scenario, restart, source, snoozed) => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const receipt = transitionReceipt();
    storage.seedLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY, receipt);
    const firstWorker = persistenceFor(storage);
    await firstWorker.setSnooze();
    if (restart) storage.restartBrowser();
    const reconstructedWorker = persistenceFor(storage);

    // When
    const [receiptResult, snoozeResult] = await Promise.all([
      reconstructedWorker.loadReceipt(),
      reconstructedWorker.loadSnooze(),
    ]);

    // Then
    expect(receiptResult).toEqual({ kind: 'ready', source: 'stored', value: receipt });
    expect(snoozeResult).toEqual({ kind: 'ready', source, value: snoozed });
  });

  test('projects only durable fact fields after a successful write', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const state = createServiceWorkerState();
    state.appState.lastAutomationMessage = 'keep-me';
    const before = structuredClone(state.appState);
    const broadcasts: (typeof state.appState)[] = [];
    const persistence = persistenceFor(storage, state, (appState) => broadcasts.push(appState));
    const facts = {
      ...createInitialFarmingAutomationFacts(),
      manualWatch: {
        kind: 'automation-paused',
        observedAt: 1_750_000_000_000,
        expiresAt: 1_750_000_060_000,
        recheckAt: 1_750_000_030_000,
      },
      nextEvaluationAt: 1_750_000_030_000,
    } as const;

    // When
    const result = await persistence.saveFacts(facts);

    // Then
    expect(result).toEqual({ kind: 'written' });
    expect(state.appState).toEqual({
      ...before,
      manualWatchState: 'automation-paused',
      nextAutomationCheckAt: 1_750_000_030_000,
    });
    expect(broadcasts).toEqual([state.appState]);
  });

  test('persists a policy patch independently from automation facts', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const state = createServiceWorkerState();
    const facts = createInitialFarmingAutomationFacts();
    storage.seedLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY, facts);
    const persistence = persistenceFor(storage, state);
    // When
    await persistence.savePolicyPatch({
      queue: [game('game-b', 'campaign-b')],
      queueEntryMetadataByKey: {
        'campaign:campaign-b': {
          source: 'favorite-auto',
          addedAt: 1_750_000_000_000,
          reason: 'favorite-discovered',
        },
      },
      campaignAvailabilityByKey: {},
    });

    // Then
    expect(state.appState.queue).toEqual([game('game-b', 'campaign-b')]);
    expect(storage.getLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY)).toEqual(facts);
  });

  test('commits app state snapshot and receipt without broadcasting', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const state = createServiceWorkerState();
    state.appState.selectedGame = game('game-a', 'campaign-a');
    state.cachedDropsSnapshot = [drop('drop-a', 'campaign-a')];
    const nextAppState = structuredClone(state.appState);
    nextAppState.selectedGame = game('game-b', 'campaign-b');
    const nextSnapshot = [drop('drop-b', 'campaign-b')];
    const receipt = transitionReceipt();
    const broadcastedReceipts: unknown[] = [];
    const persistence = persistenceFor(storage, state, () =>
      broadcastedReceipts.push(storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)),
    );

    // When
    const result = await persistence.commitTransition({
      expectedSessionRevision: 'revision-1',
      nextAppState,
      nextDropsSnapshot: nextSnapshot,
      receipt,
    });

    // Then
    expect(result).toEqual({ kind: 'committed' });
    expect(storage.getLocalSetPayloads()).toEqual([
      {
        appState: state.appState,
        [DROPS_SNAPSHOT_CACHE_KEY]: state.cachedDropsSnapshot,
        [FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY]: receipt,
      },
    ]);
    expect(broadcastedReceipts).toEqual([]);
  });

  test('updates cleanup only for the current receipt attempt', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const receipt = transitionReceipt();
    storage.seedLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY, receipt);
    const persistence = persistenceFor(storage);
    const cleanup = {
      kind: 'released',
      releasedAt: 1_750_000_010_000,
      method: 'neutralized',
    } as const;

    // When
    const result = await persistence.updateReceiptCleanup({
      attemptId: receipt.attemptId,
      cleanup,
    });

    // Then
    expect(result).toEqual({ kind: 'written' });
    expect(storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)).toEqual({
      ...receipt,
      cleanup,
    });
  });

  test('fails closed without partial mutation when the atomic write rejects', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const state = createServiceWorkerState();
    state.appState.selectedGame = game('game-a', 'campaign-a');
    state.cachedDropsSnapshot = [drop('drop-a', 'campaign-a')];
    const beforeAppState = structuredClone(state.appState);
    const beforeSnapshot = structuredClone(state.cachedDropsSnapshot);
    const previousReceipt = transitionReceipt();
    storage.seedLocal('appState', beforeAppState);
    storage.seedLocal(DROPS_SNAPSHOT_CACHE_KEY, beforeSnapshot);
    storage.seedLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY, previousReceipt);
    storage.failNextLocalSet();
    const broadcasts: (typeof state.appState)[] = [];
    const persistence = persistenceFor(storage, state, (appState) => broadcasts.push(appState));
    const nextAppState = structuredClone(state.appState);
    nextAppState.selectedGame = game('game-b', 'campaign-b');

    // When
    const result = await persistence.commitTransition({
      expectedSessionRevision: 'revision-1',
      nextAppState,
      nextDropsSnapshot: [drop('drop-b', 'campaign-b')],
      receipt: { ...transitionReceipt(), attemptId: 'attempt-b' },
    });

    // Then
    expect(result).toEqual({ kind: 'failed', reason: 'transition-commit-failed' });
    expect(state.appState).toEqual(beforeAppState);
    expect(state.cachedDropsSnapshot).toEqual(beforeSnapshot);
    expect(storage.getLocal('appState')).toEqual(beforeAppState);
    expect(storage.getLocal(DROPS_SNAPSHOT_CACHE_KEY)).toEqual(beforeSnapshot);
    expect(storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)).toEqual(previousReceipt);
    expect(broadcasts).toEqual([]);
  });

  test('rejects a stale session revision before writing', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const state = createServiceWorkerState();
    const beforeAppState = state.appState;
    const persistence = createInMemoryFarmingAutomationPersistence({
      state,
      storage,
      getSessionRevision: () => 'revision-2',
      broadcast: () => undefined,
    });

    // When
    const result = await persistence.commitTransition({
      expectedSessionRevision: 'revision-1',
      nextAppState: structuredClone(state.appState),
      nextDropsSnapshot: [],
      receipt: transitionReceipt(),
    });

    // Then
    expect(result).toEqual({ kind: 'stale' });
    expect(state.appState).toBe(beforeAppState);
    expect(storage.getLocalSetPayloads()).toEqual([]);
  });

  test('uses Chrome local and session storage in the production adapter', async () => {
    // Given
    const mocks = setupChromeMocks();
    const state = createServiceWorkerState();
    const persistence = createChromeFarmingAutomationPersistence({
      state,
      getSessionRevision: () => 'revision-1',
      broadcast: () => undefined,
    });
    await persistence.setSnooze();
    const facts = createInitialFarmingAutomationFacts();

    try {
      // When
      const result = await persistence.saveFacts(facts);

      // Then
      expect(result).toEqual({ kind: 'written' });
      expect(mocks.storage.local._store.get(FARMING_AUTOMATION_FACTS_STORAGE_KEY)).toEqual(facts);
      expect(await persistence.loadSnooze()).toEqual({
        kind: 'ready',
        source: 'stored',
        value: true,
      });
    } finally {
      mocks.teardown();
    }
  });
});
