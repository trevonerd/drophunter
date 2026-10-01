import { BACKUP_MAX_BYTES, type BackupFile } from '../../shared/backup.ts';
import { sendRuntimeMessage } from '../../shared/messages.ts';

export async function exportBackupFile() {
  const response = await sendRuntimeMessage({ type: 'EXPORT_BACKUP' });
  if (!response?.success || response.backup === undefined) {
    throw new Error(response?.error ?? 'Could not export backup.');
  }
  downloadBackupFile(response.backup);
}

export async function readBackupFile(file: File): Promise<unknown> {
  if (file.size > BACKUP_MAX_BYTES) throw new Error('This file is larger than the 10 MiB limit.');
  const parsed: unknown = JSON.parse(await file.text());
  return parsed;
}

export function downloadBackupFile(backup: BackupFile) {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > BACKUP_MAX_BYTES) throw new Error('Backup exceeds the 10 MiB export limit.');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `drophunter-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
