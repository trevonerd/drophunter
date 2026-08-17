import type { ServiceWorkerState } from './runtime-state.ts';

type FarmingSessionRevisionState = {
  epoch: number;
  tail: Promise<void>;
};

const revisionsByState = new WeakMap<ServiceWorkerState, FarmingSessionRevisionState>();

function revisionState(state: ServiceWorkerState): FarmingSessionRevisionState {
  const existing = revisionsByState.get(state);
  if (existing) {
    return existing;
  }
  const created: FarmingSessionRevisionState = { epoch: 0, tail: Promise.resolve() };
  revisionsByState.set(state, created);
  return created;
}

export function currentFarmingSessionEpoch(state: ServiceWorkerState): number {
  return revisionState(state).epoch;
}

export function invalidateFarmingSessionEpoch(state: ServiceWorkerState): number {
  const revision = revisionState(state);
  revision.epoch += 1;
  return revision.epoch;
}

export function isFarmingSessionEpochCurrent(state: ServiceWorkerState, epoch: number): boolean {
  return currentFarmingSessionEpoch(state) === epoch;
}

export function runInFarmingSessionCriticalSection<T>(
  state: ServiceWorkerState,
  operation: () => Promise<T>,
): Promise<T> {
  const revision = revisionState(state);
  const result = revision.tail.then(operation);
  revision.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function runFarmingSessionMutation<T>(
  state: ServiceWorkerState,
  mutation: () => Promise<T>,
): Promise<T> {
  invalidateFarmingSessionEpoch(state);
  return runInFarmingSessionCriticalSection(state, mutation);
}
