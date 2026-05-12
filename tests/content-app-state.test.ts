import { afterEach, describe, expect, test } from 'bun:test';

import { loadStoredContentAppState, subscribeToContentAppState } from '../src/content/app-state.ts';

type RuntimeListener = (message: unknown) => void;
type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

const originalChrome = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;

function setChromeMock(chromeMock: unknown): void {
  (globalThis as typeof globalThis & { chrome?: unknown }).chrome = chromeMock;
}

describe('content app-state sync', () => {
  afterEach(() => {
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = originalChrome;
  });

  test('does not throw when chrome.storage.onChanged is unavailable in a content world', () => {
    const runtimeListeners: RuntimeListener[] = [];
    setChromeMock({
      runtime: {
        onMessage: {
          addListener(listener: RuntimeListener) {
            runtimeListeners.push(listener);
          },
          removeListener(listener: RuntimeListener) {
            const index = runtimeListeners.indexOf(listener);
            if (index !== -1) runtimeListeners.splice(index, 1);
          },
        },
      },
      storage: {
        local: {
          async get() {
            return {};
          },
        },
      },
    });

    const cleanup = subscribeToContentAppState(() => {});

    expect(runtimeListeners).toHaveLength(1);
    expect(() => cleanup()).not.toThrow();
    expect(runtimeListeners).toHaveLength(0);
  });

  test('updates from storage changes when the storage change event exists', () => {
    let storageListener: StorageListener | null = null;
    const seenStates: Array<{ autoClaimChannelPointsBonus?: boolean }> = [];
    setChromeMock({
      runtime: {
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      storage: {
        local: {
          async get() {
            return {};
          },
        },
        onChanged: {
          addListener(listener: StorageListener) {
            storageListener = listener;
          },
          removeListener(listener: StorageListener) {
            if (storageListener === listener) storageListener = null;
          },
        },
      },
    });

    const cleanup = subscribeToContentAppState((state) => seenStates.push(state));
    storageListener?.({ appState: { newValue: { autoClaimChannelPointsBonus: false } } }, 'local');

    expect(seenStates).toEqual([{ autoClaimChannelPointsBonus: false }]);
    cleanup();
    expect(storageListener).toBeNull();
  });

  test('falls back to defaults when content storage is unavailable', async () => {
    setChromeMock({
      runtime: {
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
    });

    await expect(loadStoredContentAppState()).resolves.toEqual({
      autoClaimChannelPointsBonus: true,
    });
  });
});
