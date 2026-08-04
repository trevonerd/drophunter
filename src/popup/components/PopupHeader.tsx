// Extracted from src/popup/App.tsx (PopupHeader component).
import type { AppState } from '../../types';
import { MonitorIcon, SettingsIcon, SpeakerIcon } from './icons';

export interface PopupHeaderProps {
  state: AppState;
  onMuteToggle: () => void;
  onOpenMonitor: () => void;
  onOpenSettings: () => void;
}

export function PopupHeader({ state, onMuteToggle, onOpenMonitor, onOpenSettings }: PopupHeaderProps) {
  const iconButtonClass =
    'dh-icon-button shrink-0 disabled:opacity-45 disabled:hover:bg-transparent dh-focus';
  const tabId = state.tabId;
  const hasManagedFarmingTab =
    state.isRunning &&
    state.watchTransportMode === 'managed-tab' &&
    typeof tabId === 'number' &&
    Number.isInteger(tabId) &&
    tabId >= 0;

  return (
    <header className="dh-header dh-popup-header px-3 py-2">
      <div className="dh-popup-header-brand">
        <h1 className="min-w-0 truncate font-extrabold text-sm text-[color:var(--dh-accent-ink)]">
          DropHunter
        </h1>
      </div>
      <div className="dh-popup-header-actions">
        <div className="flex shrink-0 items-center gap-1">
          {hasManagedFarmingTab && (
            <button
              type="button"
              onClick={onMuteToggle}
              className={`${iconButtonClass} text-[color:var(--dh-accent-ink)] ${
                state.muteFarmingTab ? 'dh-header-button-on' : 'dh-header-button-off'
              }`}
              aria-label={state.muteFarmingTab ? 'Turn stream audio on' : 'Mute stream audio'}
              title={state.muteFarmingTab ? 'Turn stream audio on' : 'Mute stream audio'}
            >
              <SpeakerIcon muted={state.muteFarmingTab} />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenMonitor}
            className={`${iconButtonClass} text-[color:var(--dh-accent-ink)]`}
            aria-label="Open live monitor"
            title="Live Monitor"
          >
            <MonitorIcon />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className={`${iconButtonClass} text-[color:var(--dh-accent-ink)]`}
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
