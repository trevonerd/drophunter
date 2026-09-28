import { afterEach, describe, expect, test } from 'bun:test';

import { loadStoredContentAppState, subscribeToContentAppState } from '../src/content/app-state.ts';

type RuntimeListener = (message: unknown) => void;
type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;

const originalChrome = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
const originalBrowser = (globalThis as typeof globalThis & { browser?: unknown }).browser;

function setChromeMock(chromeMock: unknown): void {
  Reflect.set(globalThis, 'chrome', chromeMock);
  Reflect.set(globalThis, 'browser', chromeMock);
}

describe('content app-state sync', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
    Object.defineProperty(globalThis, 'browser', { configurable: true, value: originalBrowser });
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
    const storageListeners: StorageListener[] = [];
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
            storageListeners.push(listener);
          },
          removeListener(listener: StorageListener) {
            const index = storageListeners.indexOf(listener);
            if (index >= 0) storageListeners.splice(index, 1);
          },
        },
      },
    });

    const cleanup = subscribeToContentAppState((state) => seenStates.push(state));
    storageListeners[0]?.({ appState: { newValue: { autoClaimChannelPointsBonus: false } } }, 'local');

    expect(seenStates).toEqual([{ autoClaimChannelPointsBonus: false }]);
    cleanup();
    expect(storageListeners).toEqual([]);
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
