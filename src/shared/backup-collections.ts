import type { AppState } from '../types/index.ts';

type Category = AppState['favoriteGames'][number] | AppState['hiddenGames'][number];
const keys = (entry: Category) => [entry.gameId, ...(entry.identityKeys ?? [])];
export function categoryMatcher(entries: Category[]) {
  const identities = new Set(entries.flatMap(keys));
  return (entry: Category) => keys(entry).some((key) => identities.has(key));
}
export const union = <T extends Category>(local: T[], added: T[]) => {
  const all = new Map(local.map((entry, index) => [index, entry]));
  const identities = new Map<string, Set<number>>();
  const indexEntry = (entry: T, index: number) => {
    for (const key of keys(entry)) {
      const indexes = identities.get(key) ?? new Set<number>();
      indexes.add(index);
      identities.set(key, indexes);
    }
  };
  local.forEach(indexEntry);
  let nextIndex = local.length;
  for (const entry of added) {
    const indexes = [...new Set(keys(entry).flatMap((key) => [...(identities.get(key) ?? [])]))].sort(
      (a, b) => a - b,
    );
    const first = indexes[0];
    if (first === undefined) {
      all.set(nextIndex, {
        ...entry,
        ...(entry.identityKeys ? { identityKeys: [...entry.identityKeys] } : {}),
      });
      indexEntry(entry, nextIndex++);
      continue;
    }
    const existing = all.get(first);
    if (!existing) continue;
    const aliases = new Set(keys(entry));
    for (const index of indexes) {
      const item = all.get(index);
      if (item)
        for (const key of keys(item)) {
          aliases.add(key);
          identities.get(key)?.delete(index);
        }
      if (index !== first) all.delete(index);
    }
    aliases.delete(existing.gameId);
    const merged = { ...existing, ...(aliases.size ? { identityKeys: [...aliases] } : {}) };
    all.set(first, merged);
    indexEntry(merged, first);
  }
  return [...all.values()];
};
export function hasUnknownBackupMetadata(input: Record<string, unknown>): boolean {
  return Object.keys(input).some(
    (key) => !['format', 'formatVersion', 'extensionVersion', 'exportedAt', 'sections'].includes(key),
  );
}
