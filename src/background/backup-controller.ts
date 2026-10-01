import { applyBackup, type BackupImportOptions, exportBackup, inspectBackup } from '../shared/backup.ts';
import { browser } from '../shared/browser-api.ts';
import { readClaimLogStrict, withClaimLogTransaction } from './claim-log.ts';
import { CLAIM_LOG_KEY } from './constants.ts';
import {
  invalidateFarmingSessionEpoch,
  runInFarmingSessionCriticalSection,
} from './farming-session-revision.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { broadcastStateUpdate } from './state-persistence.ts';
import { withStateStorageTransaction } from './state-storage-transaction.ts';

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createBackupController(state: ServiceWorkerState, invalidateAutomation: () => void) {
  const requireStopped = () => {
    if (state.appState.isRunning || state.appState.isPaused) {
      throw new Error('Stop farming before importing a backup. Pausing is not enough.');
    }
  };
  return {
    exportBackup: () =>
      withClaimLogTransaction(async () => ({
        success: true,
        backup: exportBackup(
          state.appState,
          await readClaimLogStrict(),
          browser.runtime.getManifest().version_name ?? browser.runtime.getManifest().version,
        ),
      })),
    previewBackup: (backup: unknown, options: BackupImportOptions) =>
      withClaimLogTransaction(async () => {
        const claimLog = await readClaimLogStrict();
        const inspection = inspectBackup(backup);
        if (!inspection.file || inspection.compatibility === 'incompatible')
          throw new Error(inspection.error ?? 'No compatible sections can be imported.');
        const summary = options.sections.length
          ? applyBackup(state.appState, claimLog, backup, options).summary
          : {
              favorites: state.appState.favoriteGames.length,
              hiddenGames: state.appState.hiddenGames.length,
              claimLog: claimLog.length,
              totalDropsClaimed: state.appState.totalDropsClaimed,
              totalChannelPointsClaimed: state.appState.totalChannelPointsClaimed,
              reactivationRequired: false,
              warnings: [],
            };
        return {
          success: true,
          preview: {
            revision: await fingerprint({ appState: state.appState, claimLog, backup, options }),
            inspection,
            summary,
          },
        };
      }),
    importBackup: (backup: unknown, options: BackupImportOptions, revision: string) =>
      runInFarmingSessionCriticalSection(state, () =>
        withClaimLogTransaction(async () => {
          requireStopped();
          state.backupImportInProgress = true;
          let complete: () => void = () => undefined;
          state.backupImportCompletion = new Promise<void>((resolve) => {
            complete = resolve;
          });
          try {
            const claimLog = await readClaimLogStrict();
            const initialState = JSON.stringify(state.appState);
            const currentRevision = await fingerprint({
              appState: state.appState,
              claimLog,
              backup,
              options,
            });
            requireStopped();
            if (revision !== currentRevision || initialState !== JSON.stringify(state.appState)) {
              throw new Error('Local data changed. Refresh the preview before importing.');
            }
            const result = applyBackup(state.appState, claimLog, backup, options);
            const patch = Object.fromEntries(
              Object.entries(result.appState).filter(
                ([key, value]) =>
                  JSON.stringify(value) !==
                  JSON.stringify(state.appState[key as keyof typeof state.appState]),
              ),
            );
            invalidateAutomation();
            invalidateFarmingSessionEpoch(state);
            // One storage operation commits both durable collections. Memory changes only on success.
            await withStateStorageTransaction(state, async () => {
              requireStopped();
              if (initialState !== JSON.stringify(state.appState))
                throw new Error('Local data changed. Refresh the preview before importing.');
              await browser.storage.local.set({
                appState: { ...state.appState, ...patch },
                [CLAIM_LOG_KEY]: result.claimLog,
              });
              Object.assign(state.appState, patch);
              broadcastStateUpdate(state.appState);
            });
            return { success: true };
          } finally {
            state.backupImportInProgress = false;
            state.backupImportCompletion = null;
            complete();
          }
        }),
      ),
  };
}
