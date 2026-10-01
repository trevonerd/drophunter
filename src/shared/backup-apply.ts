import type { AppState, ClaimLogEntry } from '../types/index.ts';
import { inspectBackup } from './backup-inspection.ts';
import { BACKUP_SECTION_REGISTRY } from './backup-sections.ts';
import type { BackupApplyContext, BackupImportOptions, BackupSummary } from './backup-types.ts';
export function applyBackup(
  state: AppState,
  history: ClaimLogEntry[],
  input: unknown,
  options: BackupImportOptions,
): { appState: AppState; claimLog: ClaimLogEntry[]; summary: BackupSummary } {
  const inspection = inspectBackup(input);
  if (!inspection.file || inspection.compatibility === 'incompatible')
    throw new Error(inspection.error ?? 'No compatible sections.');
  if (
    !['merge', 'replace'].includes(options.mode) ||
    !['local', 'backup'].includes(options.settings) ||
    !Array.isArray(options.sections) ||
    !options.sections.length ||
    options.sections.some((id) => typeof id !== 'string') ||
    new Set(options.sections).size !== options.sections.length
  )
    throw new Error('Choose distinct compatible sections.');
  const sections = inspection.file.sections;
  for (const id of options.sections)
    if (!Object.keys(sections).includes(id) || !Object.keys(BACKUP_SECTION_REGISTRY).includes(id))
      throw new Error(`Section ${id} cannot be imported.`);
  const context: BackupApplyContext = {
    warnings: [],
    appState: { ...state, autoStartFavoriteGames: false },
    localState: state,
    claimLog: [...history],
    options,
    historyCount: new Set(history.map((entry) => entry.id)).size,
    reactivationRequired: state.autoStartFavoriteGames,
  };
  const selected = Object.entries(BACKUP_SECTION_REGISTRY)
    .filter(([id]) => options.sections.includes(id))
    .sort((a, b) => a[1].order - b[1].order);
  for (const [id, spec] of selected) spec[options.mode](context, sections[id]?.data);
  return {
    appState: context.appState,
    claimLog: context.claimLog,
    summary: {
      warnings: context.warnings,
      favorites: context.appState.favoriteGames.length,
      hiddenGames: context.appState.hiddenGames.length,
      claimLog: context.claimLog.length,
      totalDropsClaimed: context.appState.totalDropsClaimed,
      totalChannelPointsClaimed: context.appState.totalChannelPointsClaimed,
      reactivationRequired: context.reactivationRequired,
    },
  };
}
