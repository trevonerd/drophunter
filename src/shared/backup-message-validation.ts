export function isBackupPayloadValid(payload: unknown, requiresRevision: boolean): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  if (!value.backup || typeof value.backup !== 'object' || Array.isArray(value.backup)) return false;
  if (!value.options || typeof value.options !== 'object' || Array.isArray(value.options)) return false;
  const options = value.options as Record<string, unknown>;
  return (
    (options.mode === 'merge' || options.mode === 'replace') &&
    (options.settings === 'local' || options.settings === 'backup') &&
    Array.isArray(options.sections) &&
    options.sections.length <= 100 &&
    options.sections.every((section) => typeof section === 'string' && section.length <= 100) &&
    (!requiresRevision || (typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)))
  );
}
