import type { StorageMock } from './chrome-types.ts';

export function createStorageMock(): StorageMock {
  const store = new Map<string, unknown>();
  return {
    _store: store,
    get(keys) {
      if (keys === null) return Promise.resolve(Object.fromEntries(store));
      const result: Record<string, unknown> = {};
      if (typeof keys === 'string') {
        if (store.has(keys)) result[keys] = store.get(keys);
      } else if (Array.isArray(keys)) {
        for (const key of keys) {
          if (store.has(key)) result[key] = store.get(key);
        }
      } else {
        for (const [key, fallback] of Object.entries(keys)) {
          result[key] = store.has(key) ? store.get(key) : fallback;
        }
      }
      return Promise.resolve(result);
    },
    set(items) {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
      return Promise.resolve();
    },
    remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      return Promise.resolve();
    },
    clear() {
      store.clear();
      return Promise.resolve();
    },
  };
}
