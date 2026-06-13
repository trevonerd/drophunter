// Extracted from src/popup/App.tsx (PopupHeader component).
import type { AppState } from '../../types';
import {
  BellIcon,
  DropsIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
  SpeakerIcon,
  StopIcon,
} from './icons';

export interface PopupHeaderProps {
  state: AppState;
  actionLoading: boolean;
  dropsRefreshLoading: boolean;
  onMuteToggle: () => void;
  onOpenDropsPage: () => void;
  onOpenMonitor: () => void;
  onOpenSettings: () => void;
  onNotificationsToggle: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function PopupHeader({
  state,
  actionLoading,
  dropsRefreshLoading,
  onMuteToggle,
  onOpenDropsPage,
  onOpenMonitor,
  onOpenSettings,
  onNotificationsToggle,
  onPause,
  onResume,
  onStop,
}: PopupHeaderProps) {
  const iconButtonClass =
    'dh-icon-button shrink-0 disabled:opacity-45 disabled:hover:bg-transparent dh-focus';

  return (
    <div className="dh-header dh-popup-header px-3 py-2">
      <div className="dh-popup-header-brand">
        <h1 className="min-w-0 truncate font-extrabold text-sm text-[color:var(--dh-accent-ink)]">
          DropHunter
        </h1>
        {state.isRunning && (
          <span
            className={`dh-runtime-badge ${
              state.isPaused
                ? 'border-yellow-700/35 bg-yellow-950/20 text-yellow-950'
                : 'border-green-900/30 bg-green-950/15 text-green-950'
            }`}
          >
            {state.isPaused ? 'PAUSED' : 'RUNNING'}
          </span>
        )}
      </div>
      <div className="dh-popup-header-actions">
        {state.isRunning && (
          <div className="dh-header-divider flex shrink-0 items-center gap-1 border-r pr-1">
            <button
              type="button"
              onClick={state.isPaused ? onResume : onPause}
              disabled={actionLoading}
              className={`${iconButtonClass} text-[color:var(--dh-accent-ink)]`}
              aria-label={state.isPaused ? 'Resume farming' : 'Pause farming'}
              title={state.isPaused ? 'Resume' : 'Pause'}
            >
              {state.isPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={actionLoading}
              className={`${iconButtonClass} text-[color:var(--dh-accent-ink)]`}
              aria-label="Stop farming"
              title="Stop"
            >
              <StopIcon />
            </button>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
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
          <button
            type="button"
            onClick={onOpenDropsPage}
            disabled={dropsRefreshLoading}
            className={`${iconButtonClass} text-[color:var(--dh-accent-ink)]`}
            aria-label={dropsRefreshLoading ? 'Twitch Drops sync in progress' : 'Open Twitch Drops'}
            title={dropsRefreshLoading ? 'Twitch Drops sync in progress' : 'Twitch Drops'}
          >
            <DropsIcon />
          </button>
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
          <button
            type="button"
            onClick={onNotificationsToggle}
            className={`${iconButtonClass} ${
              state.notificationsEnabled ? 'text-[color:var(--dh-accent-ink)]' : 'dh-header-muted'
            }`}
            aria-label={state.notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
            title={state.notificationsEnabled ? 'Notifications on' : 'Notifications off'}
          >
            <BellIcon muted={!state.notificationsEnabled} />
          </button>
        </div>
      </div>
    </div>
  );
}
