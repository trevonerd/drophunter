import { hasUnknownBackupMetadata } from './backup-collections.ts';
import { migrateBackupSection } from './backup-migrations.ts';
import { BACKUP_SECTION_REGISTRY, cleanSection, isRecord } from './backup-sections.ts';
import { BACKUP_MAX_BYTES, type BackupFile, type BackupInspection } from './backup-types.ts';
export function inspectBackup(input: unknown): BackupInspection {
  const result: BackupInspection = {
    file: null,
    extensionVersion: '',
    exportedAt: '',
    compatibility: 'incompatible',
    sections: [],
  };
  if (new TextEncoder().encode(JSON.stringify(input) ?? '').length > BACKUP_MAX_BYTES)
    return { ...result, error: 'Backup exceeds 10 MiB.' };
  if (
    !isRecord(input) ||
    input.format !== 'drophunter-backup' ||
    input.formatVersion !== 1 ||
    !isRecord(input.sections) ||
    typeof input.extensionVersion !== 'string' ||
    typeof input.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.exportedAt))
  )
    return {
      ...result,
      error: 'This backup format cannot be imported. A compatible format or migration is required.',
    };
  const sections: BackupFile['sections'] = {};
  let migrated = false;
  for (const [id, raw] of Object.entries(input.sections)) {
    const spec = Object.keys(BACKUP_SECTION_REGISTRY).includes(id)
      ? BACKUP_SECTION_REGISTRY[id as keyof typeof BACKUP_SECTION_REGISTRY]
      : undefined;
    const section = {
      id,
      label: spec?.label ?? id,
      compatible: false,
      reason: undefined as string | undefined,
      unknownFields: [] as string[],
    };
    try {
      if (!spec) throw new Error('Unknown section; excluded from import.');
      if (!isRecord(raw) || typeof raw.version !== 'number') throw new Error('Invalid section version.');
      const migration = migrateBackupSection(raw.data, raw.version, spec.version, spec.migrations);
      migrated ||= migration.migrated;
      const cleaned = cleanSection(id, migration.data);
      section.compatible = true;
      section.unknownFields = [
        ...cleaned.unknownFields,
        ...Object.keys(raw).filter((key) => key !== 'version' && key !== 'data'),
      ];
      sections[id] = { version: spec.version, data: cleaned.data };
    } catch (error) {
      section.reason = error instanceof Error ? error.message : 'Invalid section.';
    }
    result.sections.push(section);
  }
  result.extensionVersion = input.extensionVersion;
  result.exportedAt = input.exportedAt;
  result.file = {
    format: 'drophunter-backup',
    formatVersion: 1,
    extensionVersion: input.extensionVersion,
    exportedAt: input.exportedAt,
    sections,
  };
  result.compatibility = !result.sections.some((s) => s.compatible)
    ? 'incompatible'
    : result.sections.some((s) => !s.compatible || s.unknownFields?.length)
      ? 'partial'
      : migrated
        ? 'migrated'
        : 'compatible';
  if (hasUnknownBackupMetadata(input) && result.compatibility !== 'incompatible') {
    result.sections.push({
      id: '$metadata',
      label: 'Unknown metadata',
      compatible: false,
      reason: 'Unknown metadata is excluded.',
    });
    result.compatibility = 'partial';
  }
  return result;
}
