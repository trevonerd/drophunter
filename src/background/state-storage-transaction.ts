import type { ServiceWorkerState } from './runtime-state.ts';

const queues = new WeakMap<ServiceWorkerState, Promise<unknown>>();

export function withStateStorageTransaction<T>(
  state: ServiceWorkerState,
  operation: () => Promise<T>,
): Promise<T> {
  const result = (queues.get(state) ?? Promise.resolve()).then(operation);
  queues.set(
    state,
    result.catch(() => undefined),
  );
  return result;
}
