import { browser } from '../shared/browser-api.ts';
import { DROPS_SNAPSHOT_CACHE_KEY, TIMING_STATE_KEY, TWITCH_SESSION_STORAGE_KEY } from './constants.ts';

export const STORAGE_SCHEMA_VERSION_KEY = 'storageSchemaVersion';
export const STORAGE_SCHEMA_VERSION = 2;

const LEGACY_TWITCH_SESSION_KEYS = [
  'oauthToken',
  'authToken',
  'accessToken',
  'token',
  'userId',
  'userID',
  'deviceId',
  'local_copy_unique_id',
  'device_id',
  'uuid',
  'clientSessionId',
  'client-session-id',
  'clientIntegrity',
  'client-integrity',
  'clientId',
] as const;

const LOCAL_SCHEMA_V1_TRANSIENT_KEYS = [
  TWITCH_SESSION_STORAGE_KEY,
  'twitchIntegrity',
  DROPS_SNAPSHOT_CACHE_KEY,
  TIMING_STATE_KEY,
  ...LEGACY_TWITCH_SESSION_KEYS,
] as const;

function normalizeStoredSchemaVersion(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function migrateExtensionStorage(): Promise<void> {
  const stored = await browser.storage.local.get([STORAGE_SCHEMA_VERSION_KEY]);
  const storedVersion = normalizeStoredSchemaVersion(stored[STORAGE_SCHEMA_VERSION_KEY]);
  if (storedVersion >= STORAGE_SCHEMA_VERSION) {
    return;
  }

  if (storedVersion < 1) {
    await Promise.all([
      browser.storage.local.remove([...LOCAL_SCHEMA_V1_TRANSIENT_KEYS]),
      browser.storage.sync.remove([...LEGACY_TWITCH_SESSION_KEYS]),
      browser.storage.session.remove([TIMING_STATE_KEY]),
    ]);
  }

  if (storedVersion < 2) {
    const storedAppState = await browser.storage.local.get(['appState']);
    const appState = storedAppState.appState;
    if (appState && typeof appState === 'object' && !Array.isArray(appState)) {
      await browser.storage.local.set({
        appState: { ...appState, campaignPriorityMode: 'priority-list-only' },
      });
    }
  }
  await browser.storage.local.set({ [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION });
}

export async function initializeAfterStorageMigration(
  loadPersistedState: () => Promise<void>,
): Promise<void> {
  await migrateExtensionStorage();
  await loadPersistedState();
}
