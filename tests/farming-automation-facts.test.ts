import { describe, expect, test } from 'bun:test';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
  type FarmingAutomationPersistence,
  type FarmingSessionTransitionReceiptV1,
  type WatchCleanupV1,
} from '../src/background/farming-automation-contracts.ts';
import {
  createInitialFarmingAutomationFacts,
  normalizeFarmingAutomationFacts,
  normalizeFarmingSessionTransitionReceipt,
} from '../src/background/farming-automation-facts.ts';
import {
  createInMemoryFarmingAutomationPersistence,
  createInMemoryFarmingAutomationStorage,
} from '../src/background/farming-automation-persistence.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';

function receiptFixture(): FarmingSessionTransitionReceiptV1 {
  return {
    version: 1,
    attemptId: 'attempt-a-b',
    transition: 'preemption',
    fromCampaignKey: 'campaign-a',
    toCampaignKey: 'campaign-b',
    toStreamerName: 'streamer-b',
    committedAt: 1_750_000_000_000,
    sessionRevision: 'revision-7',
    fromWatch: {
      kind: 'managed-tab',
      tabId: 17,
      ownershipToken: 'owner-a',
      expectedChannel: 'streamer-a',
    },
    toWatch: { kind: 'tabless', targetKey: 'campaign-b:streamer-b' },
    cleanup: {
      kind: 'pending',
      obsolete: {
        kind: 'managed-tab',
        tabId: 17,
        ownershipToken: 'owner-a',
        expectedChannel: 'streamer-a',
      },
    },
  };
}

const cleanupVariants: readonly WatchCleanupV1[] = [
  { kind: 'not-required' },
  { kind: 'released', releasedAt: 1_750_000_010_000, method: 'closed' },
  { kind: 'abandoned-unproven', acknowledgedAt: 1_750_000_020_000 },
];

const unsupportedStorageRecords = [
  {
    key: FARMING_AUTOMATION_FACTS_STORAGE_KEY,
    read: (persistence: FarmingAutomationPersistence) => persistence.loadFacts(),
  },
  {
    key: FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
    read: (persistence: FarmingAutomationPersistence) => persistence.loadReceipt(),
  },
] as const;

describe('Farming automation fact normalization', () => {
  test('returns canonical V1 defaults when the record is absent', () => {
    // Given
    const expected = createInitialFarmingAutomationFacts();

    // When
    const result = normalizeFarmingAutomationFacts(undefined);

    // Then
    expect(result).toEqual({ kind: 'missing', value: expected });
  });

  test('round-trips valid V1 records', () => {
    // Given
    const facts = {
      version: 1,
      lastPreemption: {
        attemptId: 'attempt-a-b',
        fromCampaignKey: 'campaign-a',
        toCampaignKey: 'campaign-b',
        committedAt: 1_750_000_000_000,
        sessionRevision: 'revision-7',
      },
      manualWatch: {
        kind: 'eligible-manual',
        observedAt: 1_750_000_001_000,
        expiresAt: 1_750_000_061_000,
        recheckAt: 1_750_000_031_000,
      },
      nextEvaluationAt: 1_750_000_031_000,
    } as const;

    // When
    const result = normalizeFarmingAutomationFacts(facts);

    // Then
    expect(result).toEqual({ kind: 'valid', value: facts });
  });

  test('repairs malformed fields in a known V1 record', () => {
    // Given
    const malformed = {
      version: 1,
      lastPreemption: { attemptId: 42 },
      manualWatch: { kind: 'unknown' },
      nextEvaluationAt: Number.NaN,
    };

    // When
    const result = normalizeFarmingAutomationFacts(malformed);

    // Then
    expect(result).toEqual({
      kind: 'repairable',
      value: createInitialFarmingAutomationFacts(),
    });
  });

  test('strips extra fields from a known V1 record', () => {
    // Given
    const input = {
      version: 1,
      lastPreemption: null,
      manualWatch: {
        kind: 'eligible-manual',
        observedAt: 10,
        expiresAt: 20,
        recheckAt: 15,
        workflowPhase: 'must-not-persist',
      },
      nextEvaluationAt: null,
      inFlight: true,
    };

    // When
    const result = normalizeFarmingAutomationFacts(input);

    // Then
    expect(result).toEqual({
      kind: 'repairable',
      value: {
        version: 1,
        lastPreemption: null,
        manualWatch: {
          kind: 'eligible-manual',
          observedAt: 10,
          expiresAt: 20,
          recheckAt: 15,
        },
        nextEvaluationAt: null,
      },
    });
  });

  test.each([null, 'invalid', { version: 2 }] as const)('preserves unsupported facts input %#', (input) => {
    // Given
    const raw: unknown = input;

    // When
    const result = normalizeFarmingAutomationFacts(raw);

    // Then
    expect(result).toEqual({ kind: 'unsupported', raw });
  });

  test('repairs a known V1 storage record before returning it', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    storage.seedLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY, {
      version: 1,
      manualWatch: { kind: 'unknown' },
    });
    const persistence = createInMemoryFarmingAutomationPersistence({
      state: createServiceWorkerState(),
      storage,
      getSessionRevision: () => 'revision-1',
      broadcast: () => undefined,
    });

    // When
    const result = await persistence.loadFacts();

    // Then
    const expected = createInitialFarmingAutomationFacts();
    expect(result).toEqual({ kind: 'ready', source: 'repaired', value: expected });
    expect(storage.getLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY)).toEqual(expected);
  });

  test('fails closed when canonical repair cannot be persisted', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const malformed = { version: 1, manualWatch: { kind: 'unknown' } };
    storage.seedLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY, malformed);
    storage.failNextLocalSet();
    const persistence = createInMemoryFarmingAutomationPersistence({
      state: createServiceWorkerState(),
      storage,
      getSessionRevision: () => 'revision-1',
      broadcast: () => undefined,
    });

    // When
    const result = await persistence.loadFacts();

    // Then
    expect(result).toEqual({ kind: 'failed', reason: 'storage-unavailable' });
    expect(storage.getLocal(FARMING_AUTOMATION_FACTS_STORAGE_KEY)).toEqual(malformed);
  });

  test.each(unsupportedStorageRecords)('keeps an unknown-version $key record raw', async ({ key, read }) => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    const raw = { version: 2, opaque: 'keep-me' };
    storage.seedLocal(key, raw);
    const persistence = createInMemoryFarmingAutomationPersistence({
      state: createServiceWorkerState(),
      storage,
      getSessionRevision: () => 'revision-1',
      broadcast: () => undefined,
    });

    // When
    const result = await read(persistence);

    // Then
    expect(result).toEqual({ kind: 'failed', reason: 'unsupported-record' });
    expect(storage.getLocal(key)).toEqual(raw);
  });
});

describe('Farming session transition receipt normalization', () => {
  test('round-trips managed-tab ownership and pending cleanup', () => {
    // Given
    const receipt = receiptFixture();

    // When
    const result = normalizeFarmingSessionTransitionReceipt(receipt);

    // Then
    expect(result).toEqual({ kind: 'valid', value: receipt });
  });

  test('strips provisional fields from a known V1 receipt', () => {
    // Given
    const receipt = receiptFixture();
    const input = { ...receipt, provisionalHandle: 'must-not-persist' };

    // When
    const result = normalizeFarmingSessionTransitionReceipt(input);

    // Then
    expect(result).toEqual({ kind: 'repairable', value: receipt });
  });

  test.each(cleanupVariants)('round-trips cleanup variant %#', (cleanup) => {
    // Given
    const receipt = { ...receiptFixture(), cleanup };

    // When
    const result = normalizeFarmingSessionTransitionReceipt(receipt);

    // Then
    expect(result).toEqual({ kind: 'valid', value: receipt });
  });

  test('repairs a malformed known V1 receipt to null', () => {
    // Given
    const malformed = { version: 1, attemptId: 42 };

    // When
    const result = normalizeFarmingSessionTransitionReceipt(malformed);

    // Then
    expect(result).toEqual({ kind: 'repairable', value: null });
  });

  test('removes a malformed known V1 receipt during canonical repair', async () => {
    // Given
    const storage = createInMemoryFarmingAutomationStorage();
    storage.seedLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY, {
      version: 1,
      attemptId: 42,
    });
    const persistence = createInMemoryFarmingAutomationPersistence({
      state: createServiceWorkerState(),
      storage,
      getSessionRevision: () => 'revision-1',
      broadcast: () => undefined,
    });

    // When
    const result = await persistence.loadReceipt();

    // Then
    expect(result).toEqual({ kind: 'ready', source: 'repaired', value: null });
    expect(storage.getLocal(FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY)).toBeUndefined();
  });
});
