import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createBackupController } from '../src/background/backup-controller.ts';
import { appendClaimLogEntries, withClaimLogTransaction } from '../src/background/claim-log.ts';
import { withRuntimeBackupGuard } from '../src/background/runtime-backup-guard.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { handleStartFarming } from '../src/background/session-lifecycle-start.ts';
import { saveState } from '../src/background/state-persistence.ts';
import { type BackupImportOptions, exportBackup } from '../src/shared/backup.ts';
import { isRuntimeRequest } from '../src/shared/messages.ts';
import { type ChromeMocks, setupChromeMocks } from './mocks/chrome.ts';

let mocks: ChromeMocks;
beforeEach(() => {
  mocks = setupChromeMocks();
});
afterEach(() => mocks.teardown());
const options: BackupImportOptions = { mode: 'merge', settings: 'local', sections: ['statistics'] };

describe('portable backup storage boundary', () => {
  test('a previously admitted setting blocks import; admitted import blocks later settings and clears on failure', async () => {
    const state = createServiceWorkerState();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setting = withRuntimeBackupGuard(
      state,
      async () => {
        await barrier;
        state.appState.autoStartFavoriteGames = true;
      },
      { type: 'SET_AUTO_START_FAVORITES' },
    );
    await expect(withRuntimeBackupGuard(state, () => undefined, { type: 'IMPORT_BACKUP' })).rejects.toThrow(
      'Another action',
    );
    expect(state.backupImportRequested).toBe(false);
    release();
    await setting;
    let fail: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const restore = withRuntimeBackupGuard(
      state,
      async () => {
        await blocked;
        throw new Error('failed');
      },
      { type: 'IMPORT_BACKUP' },
    );
    await expect(
      withRuntimeBackupGuard(state, () => undefined, { type: 'SET_AUTO_START_FAVORITES' }),
    ).rejects.toThrow('restore is in progress');
    fail();
    await expect(restore).rejects.toThrow('failed');
    expect(state.runtimeHandlersInFlight).toBe(0);
    expect(state.backupImportRequested).toBe(false);
  });
  test('a save admitted before import cannot overwrite the imported durable totals', async () => {
    const state = createServiceWorkerState();
    await saveState(state);
    const source = createServiceWorkerState().appState;
    source.totalChannelPointsClaimed = 7;
    const file = exportBackup(source, [], '4.0.0');
    const controller = createBackupController(state, () => undefined);
    const preview = await controller.previewBackup(file, options);
    const originalSet = mocks.storage.local.set;
    let unblock: () => void = () => undefined;
    let started: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let writes = 0;
    mocks.storage.local.set = async (value) => {
      const snapshot = JSON.parse(JSON.stringify(value));
      if (writes++ === 0) {
        started();
        await barrier;
      }
      await originalSet(snapshot);
    };
    const oldSave = saveState(state);
    await entered;
    let restored = false;
    const restore = controller.importBackup(file, options, preview.preview.revision).then(() => {
      restored = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(restored).toBe(false);
    unblock();
    await oldSave;
    await restore;
    expect(state.appState.totalChannelPointsClaimed).toBe(7);
    const stored = await mocks.storage.local.get('appState');
    expect(stored.appState).toMatchObject({ totalChannelPointsClaimed: 7 });
  });
  test('discovers sections before any selection without applying data', async () => {
    const state = createServiceWorkerState();
    const controller = createBackupController(state, () => undefined);
    const file = exportBackup(state.appState, [], 'future-release');
    const result = await controller.previewBackup(file, { ...options, sections: [] });
    expect(result.preview.inspection.sections.some((section) => section.id === 'settings')).toBe(true);
    expect(result.preview.summary.totalChannelPointsClaimed).toBe(0);
    expect(mocks.storage.local._store.size).toBe(0);
  });

  test('blocks starts during commit and makes ordinary saves wait for the imported counters', async () => {
    const state = createServiceWorkerState();
    const source = createServiceWorkerState().appState;
    source.totalChannelPointsClaimed = 20;
    const file = exportBackup(source, [], '4.0.0');
    const controller = createBackupController(state, () => undefined);
    const preview = await controller.previewBackup(file, options);
    const originalSet = mocks.storage.local.set;
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocks.storage.local.set = async (value) => {
      entered();
      await blocked;
      await originalSet(value);
    };
    const restore = controller.importBackup(file, options, preview.preview.revision);
    await started;
    expect(state.backupImportInProgress).toBe(true);
    const start = await handleStartFarming(state, {});
    expect(start.success).toBe(false);
    let saved = false;
    const ordinarySave = saveState(state).then(() => {
      saved = true;
    });
    await Promise.resolve();
    expect(saved).toBe(false);
    state.appState.lastSuccessfulRefreshAt = 123;
    release();
    await restore;
    await ordinarySave;
    expect(state.appState.lastSuccessfulRefreshAt).toBe(123);
    expect(state.appState.totalChannelPointsClaimed).toBe(20);
    expect(state.backupImportCompletion).toBe(null);
    expect(state.backupImportInProgress).toBe(false);
  });
  test('commits counters and history together, disables automatic start without authorizing a queue', async () => {
    const state = createServiceWorkerState();
    state.appState.totalChannelPointsClaimed = 10;
    state.appState.autoStartFavoriteGames = true;
    const source = createServiceWorkerState().appState;
    source.totalChannelPointsClaimed = 20;
    const file = exportBackup(source, [], '4.0.0-beta.49');
    let invalidated = 0;
    const controller = createBackupController(state, () => {
      invalidated += 1;
    });
    const preview = await controller.previewBackup(file, options);
    expect(preview.preview.summary.totalChannelPointsClaimed).toBe(30);
    expect(state.appState.totalChannelPointsClaimed).toBe(10);
    await controller.importBackup(file, options, preview.preview.revision);
    expect(state.appState.totalChannelPointsClaimed).toBe(30);
    expect(state.appState.autoStartFavoriteGames).toBe(false);
    expect(state.appState.manualQueueAuthorized).toBe(false);
    expect(mocks.storage.local._store.get('claimLog')).toEqual([]);
    expect(invalidated).toBe(1);
    expect(mocks.notifications._notifications).toEqual([]);
  });

  test('rejects stale previews and running or paused sessions', async () => {
    const state = createServiceWorkerState();
    const controller = createBackupController(state, () => undefined);
    const file = exportBackup(state.appState, [], '4.0.0');
    const preview = await controller.previewBackup(file, options);
    state.appState.totalChannelPointsClaimed = 5;
    await expect(controller.importBackup(file, options, preview.preview.revision)).rejects.toThrow('changed');
    for (const phase of ['running', 'paused']) {
      state.appState.isRunning = phase === 'running';
      state.appState.isPaused = phase === 'paused';
      await expect(controller.importBackup(file, options, preview.preview.revision)).rejects.toThrow(
        'Stop farming',
      );
    }
  });

  test('storage failure preserves memory and permits a subsequent import', async () => {
    const state = createServiceWorkerState();
    const file = exportBackup(state.appState, [], '4.0.0');
    const controller = createBackupController(state, () => undefined);
    const preview = await controller.previewBackup(file, options);
    const initial = JSON.stringify(state.appState);
    const originalSet = mocks.storage.local.set;
    mocks.storage.local.set = () => Promise.reject(new Error('storage unavailable'));
    await expect(controller.importBackup(file, options, preview.preview.revision)).rejects.toThrow(
      'storage unavailable',
    );
    expect(JSON.stringify(state.appState)).toBe(initial);
    mocks.storage.local.set = originalSet;
    expect(await controller.importBackup(file, options, preview.preview.revision)).toEqual({ success: true });
  });

  test('export propagates unreadable history instead of exporting empty data', async () => {
    const controller = createBackupController(createServiceWorkerState(), () => undefined);
    mocks.storage.local.get = () => Promise.reject(new Error('unreadable'));
    await expect(controller.exportBackup()).rejects.toThrow('unreadable');
  });

  test('claim writes wait for a backup transaction', async () => {
    const events: string[] = [];
    let finish: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transaction = withClaimLogTransaction(async () => {
      events.push('backup');
      await barrier;
      events.push('committed');
    });
    const append = appendClaimLogEntries([
      {
        id: 'campaign:drop',
        dropId: 'drop',
        dropName: 'Drop',
        gameId: 'game',
        gameName: 'Game',
        campaignLabel: 'Game · Campaign',
        claimedAt: 1,
      },
    ]);
    await Promise.resolve();
    expect(events).toEqual(['backup']);
    expect(mocks.storage.local._store.has('claimLog')).toBe(false);
    finish();
    await transaction;
    expect((await append).added).toBe(1);
  });
});

test('backup runtime requests fail closed on malformed choices or absent revision', () => {
  expect(isRuntimeRequest({ type: 'EXPORT_BACKUP' })).toBe(true);
  expect(isRuntimeRequest({ type: 'EXPORT_BACKUP', payload: {} })).toBe(false);
  expect(isRuntimeRequest({ type: 'PREVIEW_BACKUP', payload: { backup: {}, options } })).toBe(true);
  expect(isRuntimeRequest({ type: 'IMPORT_BACKUP', payload: { backup: {}, options } })).toBe(false);
  expect(
    isRuntimeRequest({
      type: 'PREVIEW_BACKUP',
      payload: { backup: {}, options: { ...options, mode: 'unsafe' } },
    }),
  ).toBe(false);
});
