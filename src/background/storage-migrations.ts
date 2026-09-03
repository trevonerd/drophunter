import { normalizeStoredAppState } from '../shared/app-state-sync.ts';
import { browser } from '../shared/browser-api.ts';
import { DROPS_SNAPSHOT_CACHE_KEY, TIMING_STATE_KEY, TWITCH_SESSION_STORAGE_KEY } from './constants.ts';
import { createExtensionUpdateAppState } from './extension-reset.ts';
import {
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  FARMING_AUTOMATION_SNOOZE_STORAGE_KEY,
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
} from './farming-automation-contracts.ts';
import { normalizeFarmingSessionTransitionReceipt } from './farming-automation-facts.ts';
import { releaseManagedTabOwnership } from './tab-management.ts';

export const STORAGE_SCHEMA_VERSION_KEY = 'storageSchemaVersion';
export const STORAGE_SCHEMA_VERSION = 2;
export const EXTENSION_VERSION_STORAGE_KEY = 'lastInitializedExtensionVersion';

const FARMING_AUTOMATION_OWNERSHIP_KEY_PREFIX = 'farmingAutomationOwnedWatch:';

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

const UPDATE_RESET_LOCAL_KEYS = [
  'twitchIntegrity',
  DROPS_SNAPSHOT_CACHE_KEY,
  TIMING_STATE_KEY,
  FARMING_AUTOMATION_FACTS_STORAGE_KEY,
  FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY,
  'automationNotificationTransitions',
  'lastActivityAt',
] as const;

export async function clearExtensionRuntimeStorage(): Promise<void> {
  const sessionState = await browser.storage.session.get(null);
  const managedOwnershipKeys = Object.keys(sessionState).filter((key) =>
    key.startsWith(FARMING_AUTOMATION_OWNERSHIP_KEY_PREFIX),
  );
  await Promise.all([
    browser.storage.local.remove([...UPDATE_RESET_LOCAL_KEYS]),
    browser.storage.session.remove([
      TIMING_STATE_KEY,
      FARMING_AUTOMATION_SNOOZE_STORAGE_KEY,
      ...managedOwnershipKeys,
    ]),
  ]);
}

async function releasePersistedManagedWatches(): Promise<void> {
  const stored = await browser.storage.local.get([FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY]);
  const normalized = normalizeFarmingSessionTransitionReceipt(
    stored[FARMING_SESSION_TRANSITION_RECEIPT_STORAGE_KEY],
  );
  if (normalized.kind === 'unsupported' || normalized.value === null) {
    return;
  }

  const receipt = normalized.value;
  const candidates = [
    receipt.fromWatch,
    receipt.toWatch,
    receipt.cleanup.kind === 'pending' ? receipt.cleanup.obsolete : null,
  ].filter((ownership) => ownership?.kind === 'managed-tab');
  const uniqueManagedWatches = Array.from(
    new Map(candidates.map((ownership) => [ownership.ownershipToken, ownership])).values(),
  );
  await Promise.all(
    uniqueManagedWatches.map((ownership) =>
      releaseManagedTabOwnership(ownership, {
        tabs: {
          get: (tabId) => browser.tabs.get(tabId),
          query: (query) => browser.tabs.query(query),
          update: async (tabId, properties) => void (await browser.tabs.update(tabId, properties)),
          remove: async (tabId) => void (await browser.tabs.remove(tabId)),
        },
        sessionStorage: {
          get: (key) => browser.storage.session.get(key),
          remove: async (key) => void (await browser.storage.session.remove(key)),
        },
      }).catch(() => ({ kind: 'abandoned-unproven' as const })),
    ),
  );
}

async function resetStorageForExtensionVersion(currentVersion: string): Promise<void> {
  const stored = await browser.storage.local.get([EXTENSION_VERSION_STORAGE_KEY, 'appState']);
  const previousVersion = stored[EXTENSION_VERSION_STORAGE_KEY];
  if (previousVersion === currentVersion) {
    return;
  }

  const hasStoredAppState =
    stored.appState !== null && typeof stored.appState === 'object' && !Array.isArray(stored.appState);
  if (!hasStoredAppState && typeof previousVersion !== 'string') {
    await browser.storage.local.set({ [EXTENSION_VERSION_STORAGE_KEY]: currentVersion });
    return;
  }

  const resetAppState = createExtensionUpdateAppState(normalizeStoredAppState(stored.appState));
  await releasePersistedManagedWatches();
  await clearExtensionRuntimeStorage();
  await browser.storage.local.set({
    appState: resetAppState,
    [EXTENSION_VERSION_STORAGE_KEY]: currentVersion,
  });
}

function normalizeStoredSchemaVersion(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function migrateExtensionStorage(
  currentVersion = browser.runtime.getManifest().version,
): Promise<void> {
  const stored = await browser.storage.local.get([STORAGE_SCHEMA_VERSION_KEY]);
  const storedVersion = normalizeStoredSchemaVersion(stored[STORAGE_SCHEMA_VERSION_KEY]);

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
  if (storedVersion < STORAGE_SCHEMA_VERSION) {
    await browser.storage.local.set({ [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION });
  }
  await resetStorageForExtensionVersion(currentVersion);
}

export async function initializeAfterStorageMigration(
  loadPersistedState: () => Promise<void>,
): Promise<void> {
  await migrateExtensionStorage();
  await loadPersistedState();
}
