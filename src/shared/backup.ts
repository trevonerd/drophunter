import type { AppState, ClaimLogEntry } from '../types/index.ts';
import { BACKUP_SECTION_REGISTRY, cleanSection } from './backup-sections.ts';
import { BACKUP_MAX_BYTES, type BackupFile } from './backup-types.ts';

export { applyBackup } from './backup-apply.ts';
export { inspectBackup } from './backup-inspection.ts';
export { BACKUP_SECTION_REGISTRY } from './backup-sections.ts';
export type { BackupFile, BackupImportOptions, BackupInspection, BackupSummary } from './backup-types.ts';
export { BACKUP_MAX_BYTES } from './backup-types.ts';
export function exportBackup(
  state: AppState,
  history: ClaimLogEntry[],
  extensionVersion: string,
): BackupFile {
  const file: BackupFile = {
    format: 'drophunter-backup',
    formatVersion: 1,
    extensionVersion,
    exportedAt: new Date().toISOString(),
    sections: Object.fromEntries(
      Object.entries(BACKUP_SECTION_REGISTRY).map(([id, spec]) => [
        id,
        {
          version: spec.version,
          data: cleanSection(id, JSON.parse(JSON.stringify(spec.export(state, history)))).data,
        },
      ]),
    ),
  };
  if (new TextEncoder().encode(JSON.stringify(file)).length > BACKUP_MAX_BYTES)
    throw new Error('Backup exceeds 10 MiB. Reduce the stored history before exporting.');
  return file;
}
