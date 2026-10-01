/** Published migrations must remain available. Keys are source versions; each step advances by one. */
export type BackupMigration = (data: unknown) => unknown;
export function migrateBackupSection(
  data: unknown,
  source: number,
  target: number,
  migrations: Record<number, BackupMigration>,
): { data: unknown; migrated: boolean } {
  if (!Number.isSafeInteger(source) || source < 1 || source > target)
    throw new Error('Unsupported section version; no migration is available.');
  let current = data;
  for (let version = source; version < target; version++) {
    const migration = migrations[version];
    if (!migration) throw new Error('Unsupported section version; no migration is available.');
    current = migration(current);
  }
  return { data: current, migrated: source !== target };
}
