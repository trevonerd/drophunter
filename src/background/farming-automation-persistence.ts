import { DROPS_SNAPSHOT_CACHE_KEY } from './constants.ts';
import type {
  FarmingAutomationFactsV1,
  FarmingAutomationPersistence,
  FarmingAutomationPersistenceContext,
  FarmingAutomationPersistenceRead,
  FarmingAutomationPersistenceWrite,
  FarmingAutomationPolicyPatch,
  FarmingAutomationStorageArea,
  FarmingSessionTransitionCommit,
  StoredRecordNormalization,
} from './farming-automation-contracts.ts';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  FARMING_AUTOMATION_SNOOZE_STORAGE_KEY,
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
} from './farming-automation-contracts.ts';
import {
  normalizeFarmingAutomationFacts,
  normalizeFarmingSessionTransitionReceipt,
} from './farming-automation-facts.ts';

import { chromeStorageArea, type InMemoryFarmingAutomationStorage } from './farming-automation-storage.ts';

export {
  createInMemoryFarmingAutomationStorage,
  InMemoryFarmingAutomationStorage,
} from './farming-automation-storage.ts';

async function tryStorageWrite(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

async function loadStoredRecord<T>(
  area: FarmingAutomationStorageArea,
  key: string,
  normalize: (input: unknown) => StoredRecordNormalization<T>,
): Promise<FarmingAutomationPersistenceRead<T>> {
  let raw: unknown;
  try {
    const stored = await area.get([key]);
    raw = stored[key];
  } catch (error) {
    if (error instanceof Error) return { kind: 'failed', reason: 'storage-unavailable' };
    throw error;
  }
  const normalized = normalize(raw);
  switch (normalized.kind) {
    case 'missing':
      return { kind: 'ready', source: 'missing', value: normalized.value };
    case 'valid':
      return { kind: 'ready', source: 'stored', value: normalized.value };
    case 'repairable':
      return (await tryStorageWrite(() =>
        normalized.value === null ? area.remove([key]) : area.set({ [key]: normalized.value }),
      ))
        ? { kind: 'ready', source: 'repaired', value: normalized.value }
        : { kind: 'failed', reason: 'storage-unavailable' };
    case 'unsupported':
      return { kind: 'failed', reason: 'unsupported-record' };
  }
}

async function storageWrite(operation: () => Promise<void>): Promise<FarmingAutomationPersistenceWrite> {
  return (await tryStorageWrite(operation))
    ? { kind: 'written' }
    : { kind: 'failed', reason: 'storage-unavailable' };
}

function createPersistence(
  context: FarmingAutomationPersistenceContext,
  local: FarmingAutomationStorageArea,
  session: FarmingAutomationStorageArea,
): FarmingAutomationPersistence {
  const stateSignature = () =>
    JSON.stringify([context.getSessionRevision(), context.state.appState, context.state.cachedDropsSnapshot]);
  const writeCurrentState = async (): Promise<void> => {
    let signature: string;
    do {
      signature = stateSignature();
      await local.set({
        appState: structuredClone(context.state.appState),
        [DROPS_SNAPSHOT_CACHE_KEY]: structuredClone(context.state.cachedDropsSnapshot),
      });
    } while (signature !== stateSignature());
  };
  const guardedWrite = async (
    values: Readonly<Record<string, unknown>>,
    publish: () => void,
  ): Promise<'written' | 'stale' | 'failed'> => {
    const signature = stateSignature();
    const metadataKeys = Object.keys(values).filter(
      (key) => key !== 'appState' && key !== DROPS_SNAPSHOT_CACHE_KEY,
    );
    let stale = false;
    const written = await tryStorageWrite(async () => {
      const previousMetadata = metadataKeys.length > 0 ? await local.get(metadataKeys) : {};
      if (signature !== stateSignature()) {
        stale = true;
        return;
      }
      await local.set(values);
      if (signature === stateSignature()) {
        publish();
        return;
      }
      stale = true;
      if (metadataKeys.length > 0) {
        const currentMetadata = await local.get(metadataKeys);
        const ownedKeys = metadataKeys.filter(
          (key) => JSON.stringify(currentMetadata[key]) === JSON.stringify(values[key]),
        );
        await local.set(
          Object.fromEntries(
            ownedKeys.filter((key) => key in previousMetadata).map((key) => [key, previousMetadata[key]]),
          ),
        );
        await local.remove(ownedKeys.filter((key) => !(key in previousMetadata)));
      }
      await writeCurrentState();
    });
    return !written ? 'failed' : stale ? 'stale' : 'written';
  };
  const persistAppState = async (
    nextAppState: FarmingAutomationPersistenceContext['state']['appState'],
    values: Readonly<Record<string, unknown>>,
  ): Promise<FarmingAutomationPersistenceWrite> => {
    if (
      (await guardedWrite({ ...values, appState: nextAppState }, () => {
        context.state.appState = nextAppState;
        context.broadcast(nextAppState);
      })) !== 'written'
    ) {
      return { kind: 'failed', reason: 'storage-unavailable' };
    }
    return { kind: 'written' };
  };
  return {
    loadFacts: () =>
      loadStoredRecord(local, FARMING_AUTOMATION_FACTS_STORAGE_KEY, normalizeFarmingAutomationFacts),
    loadReceipt: () =>
      loadStoredRecord(
        local,
        FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
        normalizeFarmingSessionTransitionReceipt,
      ),
    async loadSnooze() {
      try {
        const stored = await session.get([FARMING_AUTOMATION_SNOOZE_STORAGE_KEY]);
        const raw = stored[FARMING_AUTOMATION_SNOOZE_STORAGE_KEY];
        if (raw === undefined) {
          return { kind: 'ready', source: 'missing', value: false };
        }
        return typeof raw === 'boolean'
          ? { kind: 'ready', source: 'stored', value: raw }
          : { kind: 'failed', reason: 'unsupported-record' };
      } catch (error) {
        if (error instanceof Error) {
          return { kind: 'failed', reason: 'storage-unavailable' };
        }
        throw error;
      }
    },
    async saveFacts(facts: FarmingAutomationFactsV1) {
      const nextAppState = structuredClone(context.state.appState);
      nextAppState.manualWatchState = facts.manualWatch?.kind ?? 'inactive';
      nextAppState.nextAutomationCheckAt = facts.nextEvaluationAt;
      return persistAppState(nextAppState, {
        [FARMING_AUTOMATION_FACTS_STORAGE_KEY]: structuredClone(facts),
      });
    },
    savePolicyPatch(patch: FarmingAutomationPolicyPatch) {
      const nextAppState = structuredClone(context.state.appState);
      if (patch.activity) Object.assign(nextAppState, structuredClone(patch.activity));
      nextAppState.queue = patch.queue.map((entry) => structuredClone(entry));
      nextAppState.queueEntryMetadataByKey = structuredClone(patch.queueEntryMetadataByKey);
      nextAppState.campaignAvailabilityByKey = structuredClone(patch.campaignAvailabilityByKey);
      return persistAppState(nextAppState, {});
    },
    async commitTransition(commit: FarmingSessionTransitionCommit) {
      if (
        commit.expectedSessionRevision !== context.getSessionRevision() ||
        commit.receipt.sessionRevision !== commit.expectedSessionRevision
      ) {
        return { kind: 'stale' };
      }
      const nextAppState = structuredClone(commit.nextAppState);
      const nextSnapshot = commit.nextDropsSnapshot.map((entry) => structuredClone(entry));
      if (commit.expectedSessionRevision !== context.getSessionRevision()) {
        return { kind: 'stale' };
      }
      const written = await guardedWrite(
        {
          appState: nextAppState,
          [DROPS_SNAPSHOT_CACHE_KEY]: nextSnapshot,
          [FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY]: structuredClone(commit.receipt),
        },
        () => {
          context.state.appState = nextAppState;
          context.state.cachedDropsSnapshot = nextSnapshot;
        },
      );
      if (written === 'failed') return { kind: 'failed', reason: 'transition-commit-failed' };
      if (written === 'stale') return { kind: 'stale' };
      return { kind: 'committed' };
    },
    async updateReceiptCleanup(update) {
      const current = await loadStoredRecord(
        local,
        FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
        normalizeFarmingSessionTransitionReceipt,
      );
      switch (current.kind) {
        case 'failed':
          return { kind: 'failed', reason: current.reason };
        case 'ready':
          if (current.value === null || current.value.attemptId !== update.attemptId) {
            return { kind: 'stale' };
          }
          return storageWrite(() =>
            local.set({
              [FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY]: {
                ...current.value,
                cleanup: structuredClone(update.cleanup),
              },
            }),
          );
      }
    },
    setSnooze: () => storageWrite(() => session.set({ [FARMING_AUTOMATION_SNOOZE_STORAGE_KEY]: true })),
    clearSnooze: () => storageWrite(() => session.remove([FARMING_AUTOMATION_SNOOZE_STORAGE_KEY])),
  };
}

export function createInMemoryFarmingAutomationPersistence(
  context: FarmingAutomationPersistenceContext & {
    readonly storage: InMemoryFarmingAutomationStorage;
  },
): FarmingAutomationPersistence {
  return createPersistence(context, context.storage.local, context.storage.session);
}

export function createChromeFarmingAutomationPersistence(
  context: FarmingAutomationPersistenceContext,
): FarmingAutomationPersistence {
  return createPersistence(context, chromeStorageArea('local'), chromeStorageArea('session'));
}
