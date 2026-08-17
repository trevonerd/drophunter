import { browser } from '../shared/browser-api.ts';
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

export class InMemoryFarmingAutomationStorage {
  readonly local: FarmingAutomationStorageArea;
  readonly session: FarmingAutomationStorageArea;
  private readonly localValues = new Map<string, unknown>();
  private readonly sessionValues = new Map<string, unknown>();
  private readonly localSetPayloads: Readonly<Record<string, unknown>>[] = [];
  private localWriteFailuresRemaining = 0;

  constructor() {
    this.local = this.createArea(this.localValues, 'local');
    this.session = this.createArea(this.sessionValues, 'session');
  }

  seedLocal(key: string, value: unknown): void {
    this.localValues.set(key, structuredClone(value));
  }

  getLocal(key: string): unknown {
    return structuredClone(this.localValues.get(key));
  }

  getLocalSetPayloads(): readonly Readonly<Record<string, unknown>>[] {
    return structuredClone(this.localSetPayloads);
  }

  failNextLocalSet(): void {
    this.localWriteFailuresRemaining += 1;
  }

  restartBrowser(): void {
    this.sessionValues.clear();
  }

  private createArea(values: Map<string, unknown>, scope: 'local' | 'session'): FarmingAutomationStorageArea {
    return {
      get: async (keys) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (values.has(key)) result[key] = structuredClone(values.get(key));
        }
        return result;
      },
      set: async (items) => {
        if (scope === 'local' && this.localWriteFailuresRemaining > 0) {
          this.localWriteFailuresRemaining -= 1;
          throw new DOMException('Injected local storage failure', 'InMemoryStorageWriteError');
        }
        if (scope === 'local') this.localSetPayloads.push(structuredClone(items));
        for (const [key, value] of Object.entries(items)) {
          values.set(key, structuredClone(value));
        }
      },
      remove: async (keys) => {
        for (const key of keys) values.delete(key);
      },
    };
  }
}

export function createInMemoryFarmingAutomationStorage(): InMemoryFarmingAutomationStorage {
  return new InMemoryFarmingAutomationStorage();
}

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
  const persistAppState = async (
    nextAppState: FarmingAutomationPersistenceContext['state']['appState'],
    values: Readonly<Record<string, unknown>>,
  ): Promise<FarmingAutomationPersistenceWrite> => {
    if (!(await tryStorageWrite(() => local.set({ ...values, appState: nextAppState })))) {
      return { kind: 'failed', reason: 'storage-unavailable' };
    }
    context.state.appState = nextAppState;
    context.broadcast(nextAppState);
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
      const written = await tryStorageWrite(() =>
        local.set({
          appState: nextAppState,
          [DROPS_SNAPSHOT_CACHE_KEY]: nextSnapshot,
          [FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY]: structuredClone(commit.receipt),
        }),
      );
      if (!written) return { kind: 'failed', reason: 'transition-commit-failed' };
      context.state.appState = nextAppState;
      context.state.cachedDropsSnapshot = nextSnapshot;
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

function chromeStorageArea(scope: 'local' | 'session'): FarmingAutomationStorageArea {
  return {
    get: (keys) => browser.storage[scope].get([...keys]),
    set: (values) => browser.storage[scope].set(values),
    remove: (keys) => browser.storage[scope].remove([...keys]),
  };
}

export function createChromeFarmingAutomationPersistence(
  context: FarmingAutomationPersistenceContext,
): FarmingAutomationPersistence {
  return createPersistence(context, chromeStorageArea('local'), chromeStorageArea('session'));
}
