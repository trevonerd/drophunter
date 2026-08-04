export interface SettingRowProps {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly ariaLabel: string;
  readonly onToggle: () => void | Promise<void>;
  readonly warning?: string | null;
}

export function SettingRow({ title, description, checked, ariaLabel, onToggle, warning }: SettingRowProps) {
  return (
    <div className="dh-panel dh-contain px-3 py-2.5">
      <div className="dh-setting-row-body flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="dh-title text-xs">{title}</p>
          <p className="dh-copy mt-1 text-[11px] leading-snug">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel}
          onClick={() => void onToggle()}
          className={`dh-switch shrink-0 dh-focus ${checked ? 'dh-switch--on' : ''}`}
        >
          <span className="dh-switch__thumb" />
        </button>
      </div>
      {warning && (
        <p
          className="mt-1.5 text-[11px] text-[color:var(--dh-danger,#f04f4f)]"
          role="status"
          aria-live="polite"
        >
          {warning}
        </p>
      )}
    </div>
  );
}
