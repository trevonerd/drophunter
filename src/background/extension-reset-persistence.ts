import { browser } from '../shared/browser-api.ts';
import { DROPS_SNAPSHOT_CACHE_KEY } from './constants.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { broadcastStateUpdate } from './state-persistence.ts';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from './storage-migrations.ts';

export async function persistExtensionResetState(state: ServiceWorkerState): Promise<void> {
  await browser.storage.local.set({
    appState: state.appState,
    [DROPS_SNAPSHOT_CACHE_KEY]: [],
    [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
    [EXTENSION_VERSION_STORAGE_KEY]: browser.runtime.getManifest().version,
  });
  broadcastStateUpdate(state.appState);
}
