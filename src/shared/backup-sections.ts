import { isTrustedBackupImageUrl } from './backup-image-policy.ts';
import type { BackupMigration } from './backup-migrations.ts';
import { BACKUP_SECTION_BEHAVIORS } from './backup-section-behaviors.ts';
import { BACKUP_SETTINGS } from './backup-settings-policy.ts';
import type { BackupSectionBehavior } from './backup-types.ts';

export { BACKUP_SETTINGS } from './backup-settings-policy.ts';
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const counter = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const string = (value: unknown) => typeof value === 'string';
const identity = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const categoryFields = {
  gameId: identity,
  lastKnownName: string,
  identityKeys: (v: unknown) => Array.isArray(v) && v.every(identity),
};
const settingFields = Object.fromEntries(
  Object.entries(BACKUP_SETTINGS).map(([key, rule]) => [
    key,
    (v: unknown) =>
      Array.isArray(rule)
        ? (rule as readonly unknown[]).includes(v)
        : rule === 'boolean'
          ? typeof v === 'boolean'
          : v === null || string(v),
  ]),
);
function section(
  behavior: BackupSectionBehavior,
  label: string,
  fields: Record<string, (v: unknown) => boolean>,
  required: string[] = [],
  list = false,
  optionalFilters: Record<string, (value: unknown) => boolean> = {},
) {
  return {
    ...behavior,
    label,
    version: 1,
    fields,
    required,
    list,
    optionalFilters,
    migrations: {} as Record<number, BackupMigration>,
  };
}
export const BACKUP_SECTION_REGISTRY = {
  settings: section(BACKUP_SECTION_BEHAVIORS.settings, 'Settings', settingFields),
  statistics: section(BACKUP_SECTION_BEHAVIORS.statistics, 'Statistics', {
    totalDropsClaimed: counter,
    totalChannelPointsClaimed: counter,
  }),
  favorites: section(
    BACKUP_SECTION_BEHAVIORS.favorites,
    'Favorites',
    { ...categoryFields, addedAt: counter },
    ['gameId', 'lastKnownName', 'addedAt'],
    true,
  ),
  hidden: section(
    BACKUP_SECTION_BEHAVIORS.hidden,
    'Hidden categories',
    { ...categoryFields, hiddenAt: counter },
    ['gameId', 'lastKnownName', 'hiddenAt'],
    true,
  ),
  history: section(
    BACKUP_SECTION_BEHAVIORS.history,
    'Drop history',
    {
      id: identity,
      dropId: identity,
      claimId: string,
      dropName: string,
      benefitName: string,
      gameId: string,
      gameName: string,
      campaignId: string,
      campaignName: string,
      campaignLabel: string,
      claimedAt: counter,
      imageUrl: string,
    },
    ['id', 'dropId', 'dropName', 'gameId', 'gameName', 'campaignLabel', 'claimedAt'],
    true,
    { imageUrl: (value) => typeof value === 'string' && isTrustedBackupImageUrl(value) },
  ),
};
export function cleanSection(id: string, data: unknown): { data: unknown; unknownFields: string[] } {
  const unknownFields: string[] = [];
  if (!Object.keys(BACKUP_SECTION_REGISTRY).includes(id)) throw new Error('Unknown section.');
  const spec = BACKUP_SECTION_REGISTRY[id as keyof typeof BACKUP_SECTION_REGISTRY];
  const clean = (raw: unknown, fields: Record<string, (v: unknown) => boolean>, required: string[]) => {
    if (!isRecord(raw)) throw new Error('Expected an object.');
    const result: Record<string, unknown> = {};
    for (const key of required) if (!(key in raw)) throw new Error(`Missing ${key}.`);
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.keys(fields).includes(key)) {
        unknownFields.push(key);
        continue;
      }
      if (!fields[key]?.(value)) throw new Error(`Invalid ${key}.`);
      if (spec.optionalFilters[key] && !spec.optionalFilters[key]?.(value)) {
        if (value !== '') unknownFields.push(key);
        continue;
      }
      result[key] = value;
    }
    return result;
  };
  if (!spec.list) return { data: clean(data, spec.fields, spec.required), unknownFields };
  if (!Array.isArray(data)) throw new Error('Expected a list.');
  return {
    data: data.map((entry) => clean(entry, spec.fields, spec.required)),
    unknownFields: [...new Set(unknownFields)],
  };
}
