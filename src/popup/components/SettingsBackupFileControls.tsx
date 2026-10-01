import type { RefObject } from 'react';

interface SettingsBackupFileControlsProps {
  fileInput: RefObject<HTMLInputElement | null>;
  importButton: RefObject<HTMLButtonElement | null>;
  exporting: boolean;
  applying: boolean;
  previewLoading: boolean;
  onExport: () => void;
  onFile: (file: File | undefined) => void;
}

export function SettingsBackupFileControls(props: SettingsBackupFileControlsProps) {
  const { fileInput, importButton, exporting, applying, previewLoading, onExport, onFile } = props;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onExport}
        disabled={exporting || applying}
        className="dh-focus min-h-8 rounded-md bg-twitch-purple/70 px-3 py-1.5 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/80 disabled:cursor-wait disabled:opacity-50"
      >
        {exporting ? 'Exporting…' : 'Export backup'}
      </button>
      <button
        ref={importButton}
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={applying || previewLoading}
        aria-controls="settings-backup-file"
        className="dh-focus min-h-8 rounded-md border border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--dh-text)] transition-colors hover:border-[color:var(--dh-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Import backup
      </button>
      <input
        ref={fileInput}
        id="settings-backup-file"
        type="file"
        accept=".json,application/json"
        aria-label="Choose a DropHunter backup file"
        className="sr-only"
        onChange={(event) => onFile(event.currentTarget.files?.[0])}
      />
    </div>
  );
}
