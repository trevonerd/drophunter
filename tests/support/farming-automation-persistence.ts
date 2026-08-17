import type { ExecutionBarrier } from './farming-automation-fixtures.ts';
import { cloneFixture, createExecutionBarrier } from './farming-automation-fixtures.ts';

export interface FarmingAutomationPersistenceSnapshot {
  readonly local: Readonly<Record<string, unknown>>;
  readonly session: Readonly<Record<string, unknown>>;
}

export interface FarmingAutomationPersistenceOptions {
  readonly local?: Readonly<Record<string, unknown>>;
  readonly session?: Readonly<Record<string, unknown>>;
}

export type PersistenceStore = 'local' | 'session';

export interface PersistenceFailureRecord {
  readonly store: PersistenceStore;
  readonly message: string;
}

export interface FarmingAutomationPersistence {
  readonly failures: readonly PersistenceFailureRecord[];
  readonly getLocal: (key: string) => Promise<unknown>;
  readonly setLocal: <T>(key: string, value: T) => Promise<void>;
  readonly getSession: (key: string) => Promise<unknown>;
  readonly setSession: <T>(key: string, value: T) => Promise<void>;
  readonly remove: (store: PersistenceStore, key: string) => Promise<void>;
  readonly snapshot: () => FarmingAutomationPersistenceSnapshot;
  readonly reconstruct: () => FarmingAutomationPersistence;
  readonly restartBrowser: () => void;
  readonly failNextWrite: (store: PersistenceStore, error: Error) => void;
  readonly blockNextWrite: (store: PersistenceStore) => ExecutionBarrier<void>;
}

interface BackingStores {
  readonly local: Map<string, unknown>;
  readonly session: Map<string, unknown>;
}

function createStores(options: FarmingAutomationPersistenceOptions): BackingStores {
  return {
    local: new Map(Object.entries(options.local ?? {}).map(([key, value]) => [key, cloneFixture(value)])),
    session: new Map(Object.entries(options.session ?? {}).map(([key, value]) => [key, cloneFixture(value)])),
  };
}

function recordFromStore(store: Map<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries([...store.entries()].map(([key, value]) => [key, cloneFixture(value)]));
}

export function createFarmingAutomationPersistence(
  options: FarmingAutomationPersistenceOptions = {},
): FarmingAutomationPersistence {
  return createPersistenceAdapter(createStores(options));
}

function createPersistenceAdapter(stores: BackingStores): FarmingAutomationPersistence {
  const failures = new Map<PersistenceStore, Error>();
  const barriers = new Map<PersistenceStore, ExecutionBarrier<void>>();
  let failureRecords: PersistenceFailureRecord[] = [];

  async function write<T>(store: PersistenceStore, key: string, value: T): Promise<void> {
    const failure = failures.get(store);
    if (failure) {
      failures.delete(store);
      failureRecords = [...failureRecords, { store, message: failure.message }];
      throw failure;
    }
    const barrier = barriers.get(store);
    if (barrier) {
      barriers.delete(store);
      barrier.markStarted();
      await barrier.promise;
    }
    stores[store].set(key, cloneFixture(value));
  }

  return {
    get failures() {
      return cloneFixture(failureRecords);
    },
    async getLocal(key) {
      return cloneFixture(stores.local.get(key));
    },
    async setLocal(key, value: unknown) {
      await write('local', key, value);
    },
    async getSession(key) {
      return cloneFixture(stores.session.get(key));
    },
    async setSession(key, value: unknown) {
      await write('session', key, value);
    },
    async remove(store, key) {
      const failure = failures.get(store);
      if (failure) {
        failures.delete(store);
        failureRecords = [...failureRecords, { store, message: failure.message }];
        throw failure;
      }
      stores[store].delete(key);
    },
    snapshot() {
      return { local: recordFromStore(stores.local), session: recordFromStore(stores.session) };
    },
    reconstruct() {
      return createPersistenceAdapter(stores);
    },
    restartBrowser() {
      stores.session.clear();
    },
    failNextWrite(store, error) {
      failures.set(store, error);
    },
    blockNextWrite(store) {
      const barrier = createExecutionBarrier<void>();
      barriers.set(store, barrier);
      return barrier;
    },
  };
}
