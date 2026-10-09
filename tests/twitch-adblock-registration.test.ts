import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createBackupController } from '../src/background/backup-controller.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { createServiceWorkerStateLifecycle } from '../src/background/service-worker-state-lifecycle.ts';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import { createTwitchAdblockController } from '../src/background/twitch-adblock.ts';
import { type BackupImportOptions, exportBackup } from '../src/shared/backup.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

let mocks: ChromeMocks;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());

const scriptId = 'drophunter-twitch-adblock';
const readScripts = () => mocks.scripting.getRegisteredContentScripts();

test('blocked ad totals persist concurrent reports and failed writes do not publish a count', async () => {
  const state = createServiceWorkerState();
  const controller = createTwitchAdblockController(state);
  await Promise.all([
    controller.recordBlockedAds(2, 'https://www.twitch.tv/fixture'),
    controller.recordBlockedAds(3, 'https://player.twitch.tv/'),
  ]);
  expect(state.appState.totalTwitchAdsBlocked).toBe(5);
  expect(mocks.storage.local._store.get('appState')).toMatchObject({ totalTwitchAdsBlocked: 5 });
  expect(await controller.recordBlockedAds(2, 'https://example.test/')).toMatchObject({ success: false });
  expect(state.appState.totalTwitchAdsBlocked).toBe(5);
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  await expect(controller.recordBlockedAds(1, 'https://www.twitch.tv/fixture')).rejects.toThrow();
  expect(state.appState.totalTwitchAdsBlocked).toBe(5);
});

test('registers only the future-page MAIN-world script and preserves unrelated registrations', async () => {
  const state = createServiceWorkerState();
  const controller = createTwitchAdblockController(state);
  const unrelated = { id: 'other', js: ['other.js'], matches: ['https://example.test/*'] };
  await mocks.scripting.registerContentScripts([unrelated]);
  mocks.scripting.executeScript = async () => {
    throw new Error('must not inject into current pages');
  };
  mocks.tabs.update = async () => {
    throw new Error('must not reload current pages');
  };
  await controller.reconcile();
  expect(await readScripts()).toEqual([
    unrelated,
    {
      id: scriptId,
      js: ['twitch-adblock.js'],
      matches: ['https://*.twitch.tv/*'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
  await controller.reconcile();
  expect(await controller.setEnabled(false)).toEqual({ success: true, twitchAdblockEnabled: false });
  expect(await readScripts()).toEqual([unrelated]);
  expect(mocks.storage.local._store.get('appState')).toMatchObject({ twitchAdblockEnabled: false });
  await controller.setEnabled(false);
  await controller.setEnabled(true);
  expect(await readScripts()).toHaveLength(2);
});

test('repairs an obsolete registration on worker recreation', async () => {
  const state = createServiceWorkerState();
  await mocks.scripting.registerContentScripts([
    { id: scriptId, js: ['old.js'], matches: ['https://*.twitch.tv/*'], world: 'ISOLATED' },
  ]);
  await createTwitchAdblockController(state).reconcile();
  expect((await readScripts())[0]).toMatchObject({ js: ['twitch-adblock.js'], world: 'MAIN' });
  state.appState.twitchAdblockEnabled = false;
  await createTwitchAdblockController(state).reconcile();
  expect(await readScripts()).toEqual([]);
});

test.each([false, true])(
  'failed persistence restores registration and setting (enabled: %p)',
  async (enabled) => {
    const state = createServiceWorkerState();
    state.appState.twitchAdblockEnabled = !enabled;
    const controller = createTwitchAdblockController(state);
    await controller.reconcile();
    const previous = await readScripts();
    const write = mocks.storage.local.set;
    await write({ appState: state.appState });
    mocks.storage.local.set = async () => {
      throw new Error('storage unavailable');
    };
    await expect(controller.setEnabled(enabled)).rejects.toThrow('storage unavailable');
    expect(state.appState.twitchAdblockEnabled).toBe(!enabled);
    expect(mocks.storage.local._store.get('appState')).toMatchObject({ twitchAdblockEnabled: !enabled });
    expect(await readScripts()).toEqual(previous);
    mocks.storage.local.set = write;
    await controller.setEnabled(enabled);
    expect(state.appState.twitchAdblockEnabled).toBe(enabled);
  },
);

test('failed registration restores a partially changed registry without persisting the setting', async () => {
  const state = createServiceWorkerState();
  state.appState.twitchAdblockEnabled = false;
  const register = mocks.scripting.registerContentScripts;
  mocks.scripting.registerContentScripts = async (scripts) => {
    await register(scripts);
    throw new Error('registration failed');
  };
  await expect(createTwitchAdblockController(state).setEnabled(true)).rejects.toThrow('registration failed');
  expect(await readScripts()).toEqual([]);
  expect(state.appState.twitchAdblockEnabled).toBe(false);
  expect(mocks.storage.local._store.has('appState')).toBe(false);
});

test('reports rollback failure while preserving the previous toggle', async () => {
  const state = createServiceWorkerState();
  state.appState.twitchAdblockEnabled = false;
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  mocks.scripting.unregisterContentScripts = async () => {
    throw new Error('registry unavailable');
  };
  await expect(createTwitchAdblockController(state).setEnabled(true)).rejects.toThrow(
    'could not restore Twitch adblock registration',
  );
  expect(state.appState.twitchAdblockEnabled).toBe(false);
});

test('serializes concurrent settings across controller instances', async () => {
  const state = createServiceWorkerState();
  const controller = createTwitchAdblockController(state);
  await Promise.all([controller.setEnabled(false), createTwitchAdblockController(state).setEnabled(true)]);
  expect(state.appState.twitchAdblockEnabled).toBe(true);
  expect(await readScripts()).toHaveLength(1);
  expect(mocks.storage.local._store.get('appState')).toMatchObject({ twitchAdblockEnabled: true });
});

test('queued reconciliation reads the setting after an earlier toggle commits', async () => {
  const state = createServiceWorkerState();
  const controller = createTwitchAdblockController(state);
  await controller.reconcile();
  const toggle = controller.setEnabled(false);
  await Promise.resolve();
  await Promise.all([toggle, controller.reconcile()]);
  expect(state.appState.twitchAdblockEnabled).toBe(false);
  expect(await readScripts()).toEqual([]);
});

function lifecycleFor(state: ReturnType<typeof createServiceWorkerState>, startMonitoring = () => {}) {
  return createServiceWorkerStateLifecycle(state, {
    getFarmingSession: () => ({
      acquireStreamerForSelectedGame: async () => true,
      advanceQueueIfCompleted: async () => true,
      startMonitoring,
      stopMonitoring: () => {},
      stop: async () => {},
    }),
  });
}

test('startup reconciles the hydrated disabled setting and storage reset restores the default registration', async () => {
  const state = createServiceWorkerState();
  await createTwitchAdblockController(state).reconcile();
  await mocks.storage.local.set({
    appState: { ...state.appState, twitchAdblockEnabled: false },
    [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
    [EXTENSION_VERSION_STORAGE_KEY]: mocks.runtime.getManifest().version,
  });
  const lifecycle = lifecycleFor(state);
  await lifecycle.beginInitialization(async () => {});
  expect(state.appState.twitchAdblockEnabled).toBe(false);
  expect(await readScripts()).toEqual([]);
  await lifecycle.handleExtensionStorageCleared();
  expect(state.appState.twitchAdblockEnabled).toBe(true);
  expect(await readScripts()).toHaveLength(1);
});

test('startup registry failure does not prevent saved farming from resuming', async () => {
  const state = createServiceWorkerState();
  await mocks.storage.local.set({
    appState: { ...state.appState, isRunning: true },
    [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
    [EXTENSION_VERSION_STORAGE_KEY]: mocks.runtime.getManifest().version,
  });
  await mocks.storage.session.set({ farmingBrowserSessionSeen: true });
  mocks.scripting.getRegisteredContentScripts = async () => {
    throw new Error('registry unavailable');
  };
  let starts = 0;
  await lifecycleFor(state, () => starts++).beginInitialization(async () => {});
  expect(starts).toBe(1);
  expect(state.appState.twitchAdblockUnavailable).toBe(true);
  expect(state.appState.twitchAdblockEnabled).toBe(true);
  mocks.scripting.getRegisteredContentScripts = async () => [];
  await createTwitchAdblockController(state).setEnabled(true);
  expect(state.appState.twitchAdblockUnavailable).toBe(false);
});

test('backup setting import reconciles registration and rolls it back on commit failure', async () => {
  const state = createServiceWorkerState();
  const source = createServiceWorkerState();
  source.appState.twitchAdblockEnabled = false;
  const backup = exportBackup(source.appState, [], '4.0.0');
  const options: BackupImportOptions = { mode: 'replace', settings: 'backup', sections: ['settings'] };
  const controller = createBackupController(state, () => {});
  await createTwitchAdblockController(state).reconcile();
  const previous = await readScripts();
  const preview = await controller.previewBackup(backup, options);
  const write = mocks.storage.local.set;
  mocks.storage.local.set = async () => {
    throw new Error('storage unavailable');
  };
  await expect(controller.importBackup(backup, options, preview.preview.revision)).rejects.toThrow(
    'storage unavailable',
  );
  expect(state.appState.twitchAdblockEnabled).toBe(true);
  expect(await readScripts()).toEqual(previous);
  mocks.storage.local.set = write;
  await controller.importBackup(backup, options, preview.preview.revision);
  expect(state.appState.twitchAdblockEnabled).toBe(false);
  expect(await readScripts()).toEqual([]);
});
