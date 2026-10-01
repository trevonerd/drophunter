import type { AppState } from '../types/index.ts';

type Category = AppState['favoriteGames'][number] | AppState['hiddenGames'][number];
export const overlap = (a: Category, b: Category) =>
  [a.gameId, ...(a.identityKeys ?? [])].some((key) => [b.gameId, ...(b.identityKeys ?? [])].includes(key));
export const union = <T extends Category>(local: T[], added: T[]) => {
  const all = [...local];
  for (const entry of added) {
    const indexes = all.flatMap((item, index) => (overlap(item, entry) ? [index] : []));
    const first = indexes[0];
    if (first === undefined) {
      all.push({ ...entry, ...(entry.identityKeys ? { identityKeys: [...entry.identityKeys] } : {}) });
      continue;
    }
    const existing = all[first];
    if (!existing) continue;
    const aliases = new Set([entry.gameId, ...(entry.identityKeys ?? [])]);
    for (const index of indexes) {
      const item = all[index];
      if (item) for (const key of [item.gameId, ...(item.identityKeys ?? [])]) aliases.add(key);
    }
    aliases.delete(existing.gameId);
    all[first] = { ...existing, ...(aliases.size ? { identityKeys: [...aliases] } : {}) };
    for (const index of indexes.slice(1).reverse()) all.splice(index, 1);
  }
  return all;
};
export function hasUnknownBackupMetadata(input: Record<string, unknown>): boolean {
  return Object.keys(input).some(
    (key) => !['format', 'formatVersion', 'extensionVersion', 'exportedAt', 'sections'].includes(key),
  );
}
