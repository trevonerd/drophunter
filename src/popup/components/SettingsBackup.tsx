import { useEffect, useRef, useState } from 'react';
import type { BackupImportOptions, BackupInspection, BackupSummary } from '../../shared/backup.ts';
import { sendRuntimeMessage } from '../../shared/messages.ts';
import type { AppState } from '../../types';
import { SettingsBackupFeedback } from './SettingsBackupFeedback.tsx';
import { SettingsBackupFileControls } from './SettingsBackupFileControls.tsx';
import { SettingsBackupPreview } from './SettingsBackupPreview.tsx';
import { exportBackupFile, readBackupFile } from './settings-backup-file.ts';

export function SettingsBackup({ state }: { state: AppState }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const requestId = useRef(0);
  const initializedBackup = useRef<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const [backup, setBackup] = useState<unknown>(null);
  const [options, setOptions] = useState<BackupImportOptions>({
    mode: 'merge',
    settings: 'local',
    sections: [],
  });
  const [preview, setPreview] = useState<{
    revision: string;
    inspection: BackupInspection;
    summary: BackupSummary;
  } | null>(null);
  const [previewOptionsKey, setPreviewOptionsKey] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [partialConfirmed, setPartialConfirmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const input = fileInput.current;
    if (!input) return;
    const handleCancel = () => {
      setStatus(
        backup
          ? 'File selection canceled. The current preview is unchanged.'
          : 'No backup selected. You can choose a file or cancel anytime.',
      );
    };
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, [backup]);

  useEffect(() => {
    if (status === 'Restore canceled. No changes were made.') importButton.current?.focus();
  }, [status]);

  useEffect(() => {
    if (backup === null) {
      setPreview(null);
      setPreviewOptionsKey(null);
      setPreviewLoading(false);
      return;
    }

    const id = ++requestId.current;
    const optionsKey = JSON.stringify(options);
    const isFirstPreview = initializedBackup.current !== backup;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewOptionsKey(null);
    setError(null);
    setPartialConfirmed(false);

    sendRuntimeMessage({ type: 'PREVIEW_BACKUP', payload: { backup, options } })
      .then((response) => {
        if (cancelled || id !== requestId.current) return;
        if (response?.success && response.preview) {
          setPreview(response.preview);
          setPreviewOptionsKey(optionsKey);
          initializedBackup.current = backup;
          setOptions((current) => {
            const allowed =
              response.preview?.inspection.sections
                .filter((section) => section.compatible)
                .map((section) => section.id) ?? [];
            const selected = isFirstPreview
              ? allowed
              : current.sections.filter((section) => allowed.includes(section));
            if (
              selected.length === current.sections.length &&
              selected.every((section, index) => section === current.sections[index])
            )
              return current;
            return { ...current, sections: selected };
          });
        } else {
          setError(response?.error ?? 'Could not preview this backup.');
        }
      })
      .catch(() => {
        if (!cancelled && id === requestId.current) setError('Could not preview this backup.');
      })
      .finally(() => {
        if (!cancelled && id === requestId.current) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backup, options]);

  const handleExport = async () => {
    setError(null);
    setStatus(null);
    setExporting(true);
    try {
      await exportBackupFile();
      setStatus('Backup downloaded. It contains no Twitch session credentials or secrets.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export backup.');
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    setStatus(null);
    setError(null);
    setPreview(null);
    setPartialConfirmed(false);
    if (!file) return;
    try {
      const parsed = await readBackupFile(file);
      setOptions({ mode: 'merge', settings: 'local', sections: [] });
      initializedBackup.current = null;
      setBackup(parsed);
      setStatus(`Loaded ${file.name}. Review the preview before applying it.`);
    } catch (cause) {
      setBackup(null);
      setError(
        cause instanceof SyntaxError
          ? 'This file is not valid JSON.'
          : cause instanceof Error
            ? cause.message
            : 'Could not read backup file.',
      );
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const inspection = preview?.inspection;
  const warnings = preview?.summary.warnings ?? [];
  const selectedSections = options.sections;
  const hasPartialData = Boolean(
    inspection &&
      (inspection.sections.some(
        (section) => !section.compatible || (section.unknownFields?.length ?? 0) > 0,
      ) ||
        selectedSections.length !== inspection.sections.length ||
        warnings.length > 0),
  );
  const canApply = Boolean(
    preview &&
      previewOptionsKey === JSON.stringify(options) &&
      backup !== null &&
      selectedSections.length > 0 &&
      !previewLoading &&
      !applying &&
      !state.isRunning &&
      !state.isPaused &&
      (!hasPartialData || partialConfirmed),
  );

  const handleApply = async () => {
    if (!preview || !canApply) return;
    setError(null);
    setStatus(null);
    setApplying(true);
    const revision = preview.revision;
    try {
      const response = await sendRuntimeMessage({
        type: 'IMPORT_BACKUP',
        payload: { backup, options, revision },
      });
      if (response?.success) {
        setStatus(
          preview.summary.reactivationRequired
            ? 'Backup restored. Enable Notifications and favorite auto-start again in Settings if you want to use them.'
            : 'Backup restored.',
        );
        setBackup(null);
        setPreview(null);
      } else {
        setError(response?.error ?? 'Could not restore backup. Preview the backup again, then retry.');
        setPreviewOptionsKey(null);
      }
    } catch {
      setError('Could not restore backup. Preview the backup again, then retry.');
      setPreviewOptionsKey(null);
    } finally {
      setApplying(false);
    }
  };

  const handleCancel = () => {
    setBackup(null);
    setPreview(null);
    setError(null);
    setPartialConfirmed(false);
    setStatus('Restore canceled. No changes were made.');
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <section className="dh-panel dh-contain px-3 py-2.5" aria-labelledby="settings-backup-heading">
      <div className="dh-group">
        <h2 id="settings-backup-heading" className="dh-title text-xs">
          Backup and restore
        </h2>
        <p className="dh-copy text-[11px] leading-snug">
          Save favorites, hidden games, claim history, totals, and selected settings to a file. Backups
          exclude Twitch session data and secrets.
        </p>

        <SettingsBackupFileControls
          fileInput={fileInput}
          importButton={importButton}
          exporting={exporting}
          applying={applying}
          previewLoading={previewLoading}
          onExport={() => void handleExport()}
          onFile={(file) => void handleFile(file)}
        />

        <SettingsBackupFeedback loading={previewLoading} error={error} status={status} />

        {preview && inspection && (
          <SettingsBackupPreview
            inspection={inspection}
            summary={preview.summary}
            warnings={warnings}
            options={options}
            partial={hasPartialData}
            partialConfirmed={partialConfirmed}
            applying={applying}
            farmingActive={state.isRunning || state.isPaused}
            onOptionsChange={setOptions}
            onPartialConfirmedChange={setPartialConfirmed}
            onApply={() => void handleApply()}
            onCancel={handleCancel}
            onRefreshPreview={() => {
              setError(null);
              setOptions((current) => ({ ...current }));
            }}
            canApply={canApply}
          />
        )}
      </div>
    </section>
  );
}
