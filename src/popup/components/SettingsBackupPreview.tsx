import type { BackupImportOptions, BackupInspection, BackupSummary } from '../../shared/backup.ts';

export interface SettingsBackupPreviewProps {
  inspection: BackupInspection;
  summary: BackupSummary;
  warnings: string[];
  options: BackupImportOptions;
  partial: boolean;
  partialConfirmed: boolean;
  applying: boolean;
  farmingActive: boolean;
  onOptionsChange: (options: BackupImportOptions) => void;
  onPartialConfirmedChange: (confirmed: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
  onRefreshPreview: () => void;
  canApply: boolean;
}

function formatExportDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SettingsBackupPreview({
  inspection,
  summary,
  warnings,
  options,
  partial,
  partialConfirmed,
  applying,
  farmingActive,
  onOptionsChange,
  onPartialConfirmedChange,
  onApply,
  onCancel,
  onRefreshPreview,
  canApply,
}: SettingsBackupPreviewProps) {
  const updateOption = <K extends keyof BackupImportOptions>(key: K, value: BackupImportOptions[K]) => {
    onOptionsChange({ ...options, [key]: value });
  };

  return (
    <section
      className="space-y-2.5 border-t border-[color:var(--dh-border)] pt-2.5"
      aria-labelledby="backup-preview-heading"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id="backup-preview-heading" className="dh-title text-xs">
          Backup preview
        </h3>
      </div>
      <div>
        <p className="dh-faint mt-1 text-[10px]">
          DropHunter {inspection.extensionVersion} · exported {formatExportDate(inspection.exportedAt)} ·{' '}
          {inspection.compatibility}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[color:var(--dh-text-soft)]">
        <span>Favorites: {summary.favorites}</span>
        <span>Hidden games: {summary.hiddenGames}</span>
        <span>Claim log entries: {summary.claimLog}</span>
        <span>Drops claimed: {summary.totalDropsClaimed}</span>
        <span className="col-span-2">
          Channel points claimed: {summary.totalChannelPointsClaimed.toLocaleString()}
        </span>
      </div>

      <fieldset className="space-y-1">
        <legend className="dh-title text-[11px]">Restore mode</legend>
        <label className="flex items-center gap-2 text-[11px] text-[color:var(--dh-text-soft)]">
          <input
            type="radio"
            name="backup-mode"
            value="merge"
            checked={options.mode === 'merge'}
            onChange={() => updateOption('mode', 'merge')}
            disabled={applying}
          />
          Merge with current data
        </label>
        <label className="flex items-center gap-2 text-[11px] text-[color:var(--dh-text-soft)]">
          <input
            type="radio"
            name="backup-mode"
            value="replace"
            checked={options.mode === 'replace'}
            onChange={() => updateOption('mode', 'replace')}
            disabled={applying}
          />
          Replace selected sections
        </label>
        {options.mode === 'merge' && (
          <fieldset className="space-y-1 pl-5">
            <legend className="dh-title text-[10px]">Settings</legend>
            <label className="flex items-center gap-2 text-[11px] text-[color:var(--dh-text-soft)]">
              <input
                type="radio"
                name="backup-settings"
                value="local"
                checked={options.settings === 'local'}
                onChange={() => updateOption('settings', 'local')}
                disabled={applying}
              />
              Keep current settings
            </label>
            <label className="flex items-center gap-2 text-[11px] text-[color:var(--dh-text-soft)]">
              <input
                type="radio"
                name="backup-settings"
                value="backup"
                checked={options.settings === 'backup'}
                onChange={() => updateOption('settings', 'backup')}
                disabled={applying}
              />
              Restore settings from backup
            </label>
          </fieldset>
        )}
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="dh-title text-[11px]">Data to restore</legend>
        {inspection.sections.map((section) => (
          <label
            key={section.id}
            className="flex items-start gap-2 text-[11px] text-[color:var(--dh-text-soft)]"
          >
            <input
              type="checkbox"
              checked={options.sections.includes(section.id)}
              disabled={!section.compatible || applying}
              onChange={(event) =>
                updateOption(
                  'sections',
                  event.currentTarget.checked
                    ? [...options.sections, section.id]
                    : options.sections.filter((id) => id !== section.id),
                )
              }
            />
            <span className="min-w-0">
              <span className="font-medium text-[color:var(--dh-text)]">{section.label}</span>
              {!section.compatible && (
                <span className="block text-yellow-300">
                  Skipped: {section.reason ?? 'This section is incompatible.'}
                </span>
              )}
              {!!section.unknownFields?.length && (
                <span className="block text-yellow-300">
                  Unknown fields will be ignored: {section.unknownFields.join(', ')}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {options.mode === 'merge' &&
        options.sections.includes('statistics') &&
        summary.totalChannelPointsClaimed > 0 && (
          <p className="text-[10px] leading-snug text-yellow-300">
            Merge adds the backup’s channel points total to your current total. Importing the same backup
            again repeats that sum.
          </p>
        )}
      {summary.reactivationRequired && (
        <p className="dh-copy text-[10px] leading-snug">
          Notification permission and favorite auto-start may need to be enabled again after restore.
        </p>
      )}
      <p className="dh-copy text-[10px] leading-snug">
        Browser permissions, Twitch session data, and secrets are never restored.
      </p>

      {warnings.length > 0 && (
        <ul role="status" aria-live="polite" className="space-y-1 text-[10px] leading-snug text-yellow-300">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {partial && (
        <label className="flex items-start gap-2 rounded-md bg-yellow-500/10 px-2 py-1.5 text-[10px] leading-snug text-yellow-200">
          <input
            type="checkbox"
            checked={partialConfirmed}
            onChange={(event) => onPartialConfirmedChange(event.currentTarget.checked)}
            disabled={applying}
          />
          I understand that this restore is partial. Review the warnings, skipped sections, and ignored fields
          before continuing.
        </label>
      )}

      {farmingActive && (
        <p className="text-[10px] text-yellow-300">Stop farming before restoring a backup.</p>
      )}
      <button
        type="button"
        onClick={onApply}
        disabled={!canApply}
        className="dh-focus min-h-8 w-full rounded-md bg-twitch-purple/70 px-3 py-1.5 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/80 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {applying ? 'Restoring…' : 'Restore selected data'}
      </button>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRefreshPreview}
          disabled={applying}
          className="dh-focus rounded px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--dh-text-soft)] hover:text-[color:var(--dh-text)] disabled:opacity-50"
        >
          Refresh preview
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="dh-focus rounded px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--dh-text-soft)] hover:text-[color:var(--dh-text)] disabled:opacity-50"
        >
          Cancel restore
        </button>
      </div>
    </section>
  );
}
