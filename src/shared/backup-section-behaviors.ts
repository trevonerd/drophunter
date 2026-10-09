import type { AppState, ClaimLogEntry } from '../types/index.ts';
import { categoryMatcher, union } from './backup-collections.ts';
import { BACKUP_SETTINGS } from './backup-settings-policy.ts';
import type { BackupApplyContext, BackupSectionBehavior } from './backup-types.ts';

const behavior = (
  definition: Omit<BackupSectionBehavior, 'missingFieldPolicy' | 'sensitive'>,
): BackupSectionBehavior => ({ ...definition, missingFieldPolicy: 'preserve-current', sensitive: false });
function restoreSettings(context: BackupApplyContext, data: unknown) {
  const settings = data as Record<string, unknown>;
  Object.assign(context.appState, settings);
  context.reactivationRequired ||=
    settings.notificationsEnabled === true || settings.autoStartFavoriteGames === true;
  if ('notificationsEnabled' in settings) context.appState.notificationsEnabled = false;
  context.appState.autoStartFavoriteGames = false;
}
function restoreFavorites(context: BackupApplyContext, data: unknown, merge: boolean) {
  const entries = data as AppState['favoriteGames'];
  const hiddenLocally = categoryMatcher(context.localState.hiddenGames);
  const excluded =
    merge || !context.options.sections.includes('hidden') ? entries.filter(hiddenLocally).length : 0;
  if (excluded)
    context.warnings.push(
      `${excluded} imported favorite entries are excluded because these categories are hidden locally.${merge ? ' Local classification is preserved.' : ' Select both Favorites and Hidden categories to replace their classification.'}`,
    );
  context.appState.favoriteGames = merge
    ? union(
        context.localState.favoriteGames,
        entries.filter((e) => !hiddenLocally(e)),
      )
    : union([], entries);
  if (!merge && !context.options.sections.includes('hidden'))
    context.appState.favoriteGames = context.appState.favoriteGames.filter((f) => !hiddenLocally(f));
}
function restoreHidden(context: BackupApplyContext, data: unknown, merge: boolean) {
  const entries = data as AppState['hiddenGames'];
  const favoriteLocally = categoryMatcher(context.localState.favoriteGames);
  const excluded =
    merge || !context.options.sections.includes('favorites') ? entries.filter(favoriteLocally).length : 0;
  if (excluded)
    context.warnings.push(
      `${excluded} imported hidden entries are excluded because these categories are favorites locally.${merge ? ' Local classification is preserved.' : ' Select both Favorites and Hidden categories to replace their classification.'}`,
    );
  context.appState.hiddenGames = merge
    ? union(
        context.localState.hiddenGames,
        entries.filter((e) => !favoriteLocally(e)),
      )
    : union([], entries);
  if (!merge && !context.options.sections.includes('favorites'))
    context.appState.hiddenGames = context.appState.hiddenGames.filter((h) => !favoriteLocally(h));
  if (context.options.sections.includes('favorites')) {
    const favoriteCount = context.appState.favoriteGames.length;
    const hidden = categoryMatcher(context.appState.hiddenGames);
    context.appState.favoriteGames = context.appState.favoriteGames.filter(
      (f) => (merge && favoriteLocally(f)) || !hidden(f),
    );
    const removed = favoriteCount - context.appState.favoriteGames.length;
    if (removed)
      context.warnings.push(
        `${removed} imported favorite entries are excluded because the backup also marks these categories as hidden. Hidden classification takes precedence.`,
      );
  }
}
function restoreHistory(context: BackupApplyContext, data: unknown, merge: boolean) {
  const entries = data as ClaimLogEntry[];
  const deduped = new Map<string, ClaimLogEntry>();
  for (const entry of merge ? [...context.claimLog, ...entries] : entries) {
    const previous = deduped.get(entry.id);
    if (!previous || entry.claimedAt > previous.claimedAt) deduped.set(entry.id, entry);
  }
  context.historyCount = deduped.size;
  context.claimLog = [...deduped.values()].sort((a, b) => b.claimedAt - a.claimedAt).slice(0, 5000);
  if (merge)
    context.appState.totalDropsClaimed = Math.max(context.appState.totalDropsClaimed, context.historyCount);
}
function restoreStatistics(context: BackupApplyContext, data: unknown, merge: boolean) {
  const statistics = data as { totalChannelPointsClaimed?: number; totalDropsClaimed?: number };
  if (statistics.totalChannelPointsClaimed !== undefined)
    context.appState.totalChannelPointsClaimed =
      statistics.totalChannelPointsClaimed + (merge ? context.localState.totalChannelPointsClaimed : 0);
  if (statistics.totalDropsClaimed !== undefined)
    context.appState.totalDropsClaimed = merge
      ? Math.max(context.appState.totalDropsClaimed, context.historyCount)
      : statistics.totalDropsClaimed;
  if (!Number.isSafeInteger(context.appState.totalChannelPointsClaimed))
    throw new Error('Channel point total is too large.');
}
export const BACKUP_SECTION_BEHAVIORS = {
  settings: behavior({
    order: 0,
    export: (state) =>
      Object.fromEntries(Object.keys(BACKUP_SETTINGS).map((key) => [key, state[key as keyof AppState]])),
    merge: (context, data) => {
      if (context.options.settings === 'backup') restoreSettings(context, data);
    },
    replace: restoreSettings,
    preview: (context) => (context.reactivationRequired ? 'Reactivation required' : 'Settings preserved'),
  }),
  favorites: behavior({
    order: 1,
    export: (state) => state.favoriteGames,
    merge: (context, data) => restoreFavorites(context, data, true),
    replace: (context, data) => restoreFavorites(context, data, false),
    preview: (context) => context.appState.favoriteGames.length,
  }),
  hidden: behavior({
    order: 2,
    export: (state) => state.hiddenGames,
    merge: (context, data) => restoreHidden(context, data, true),
    replace: (context, data) => restoreHidden(context, data, false),
    preview: (context) => context.appState.hiddenGames.length,
  }),
  history: behavior({
    order: 3,
    export: (_state, history) => history,
    merge: (context, data) => restoreHistory(context, data, true),
    replace: (context, data) => restoreHistory(context, data, false),
    preview: (context) => context.claimLog.length,
  }),
  statistics: behavior({
    order: 4,
    export: (state) => ({
      totalDropsClaimed: state.totalDropsClaimed,
      totalChannelPointsClaimed: state.totalChannelPointsClaimed,
    }),
    merge: (context, data) => restoreStatistics(context, data, true),
    replace: (context, data) => restoreStatistics(context, data, false),
    preview: (context) => context.appState.totalChannelPointsClaimed,
  }),
};
