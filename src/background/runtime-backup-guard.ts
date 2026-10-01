import type { RuntimeRequest } from '../shared/messages.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export async function withRuntimeBackupGuard(
  state: ServiceWorkerState,
  handler: () => unknown | Promise<unknown>,
  message: Pick<RuntimeRequest, 'type'>,
): Promise<unknown> {
  if (state.backupImportRequested) throw new Error('Backup restore is in progress. Try again shortly.');
  if (message.type === 'IMPORT_BACKUP') {
    if (state.runtimeHandlersInFlight)
      throw new Error('Another action is in progress. Refresh the preview and try again.');
    state.backupImportRequested = true;
  }
  state.runtimeHandlersInFlight += 1;
  try {
    return await handler();
  } finally {
    state.runtimeHandlersInFlight -= 1;
    if (message.type === 'IMPORT_BACKUP') state.backupImportRequested = false;
  }
}
