import {
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../../src/background/storage-migrations.ts';
import type { AppState } from '../../src/types/index.ts';
import type { ChromeMocks } from '../mocks/chrome.ts';
import { setupChromeMocks } from '../mocks/chrome.ts';

export async function importServiceWorkerWithBlockedInitialLoad(testId: string, appState: AppState) {
  const mocks = setupChromeMocks();
  await mocks.storage.local.set({ appState, [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION });

  const originalGet = mocks.chrome.storage.local.get.bind(mocks.chrome.storage.local);
  const originalSet = mocks.chrome.storage.local.set.bind(mocks.chrome.storage.local);
  const setCalls: Array<Record<string, unknown>> = [];
  let initialLoadBlocked = false;
  let releaseInitialLoad = () => {};
  const initialLoadStarted = new Promise<void>((resolveStarted) => {
    const releasePromise = new Promise<void>((resolveRelease) => {
      releaseInitialLoad = resolveRelease;
    });
    mocks.chrome.storage.local.get = async (keys) => {
      if (!initialLoadBlocked && Array.isArray(keys) && keys.includes('appState')) {
        initialLoadBlocked = true;
        resolveStarted();
        await releasePromise;
      }
      return originalGet(keys);
    };
  });

  mocks.chrome.storage.local.set = async (items) => {
    setCalls.push(items);
    return originalSet(items);
  };

  const serviceWorker = await import(
    `../../src/background/service-worker.ts?init-race-${testId}-${Date.now()}`
  );
  serviceWorker.startServiceWorker();
  await initialLoadStarted;

  return { mocks, releaseInitialLoad, setCalls } satisfies {
    mocks: ChromeMocks;
    releaseInitialLoad: () => void;
    setCalls: Array<Record<string, unknown>>;
  };
}
