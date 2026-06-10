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
    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B1030]/70';

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gradient-to-r from-[#B286FF] via-[#A970FF] to-[#8F4CFF]">
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="shrink-0 font-extrabold text-sm tracking-tight text-[#120B22]">DropHunter</h1>
        {state.isRunning && (
          <span
            className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              state.isPaused
                ? 'bg-yellow-400/20 text-yellow-200 border border-yellow-400/40'
                : 'bg-green-400/20 text-green-200 border border-green-400/40'
            }`}
          >
            {state.isPaused ? 'PAUSED' : 'RUNNING'}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state.isRunning && (
          <div className="flex shrink-0 items-center gap-1 border-r border-[#1B1030]/20 pr-1">
            <button
              type="button"
              onClick={state.isPaused ? onResume : onPause}
              disabled={actionLoading}
              className={`${iconButtonClass} text-[#1B1030]`}
              aria-label={state.isPaused ? 'Resume farming' : 'Pause farming'}
              title={state.isPaused ? 'Resume' : 'Pause'}
            >
              {state.isPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={actionLoading}
              className={`${iconButtonClass} text-[#1B1030]`}
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
            className={`${iconButtonClass} text-[#1B1030] ${
              state.muteFarmingTab ? 'bg-[#1B1030]/10' : 'bg-white/25'
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
            className={`${iconButtonClass} text-[#1B1030]`}
            aria-label={dropsRefreshLoading ? 'Twitch Drops sync in progress' : 'Open Twitch Drops'}
            title={dropsRefreshLoading ? 'Twitch Drops sync in progress' : 'Twitch Drops'}
          >
            <DropsIcon />
          </button>
          <button
            type="button"
            onClick={onOpenMonitor}
            className={`${iconButtonClass} text-[#1B1030]`}
            aria-label="Open live monitor"
            title="Live Monitor"
          >
            <MonitorIcon />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className={`${iconButtonClass} text-[#1B1030]`}
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            type="button"
            onClick={onNotificationsToggle}
            className={`${iconButtonClass} ${
              state.notificationsEnabled ? 'text-[#1B1030]' : 'text-[#1B1030]/55'
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
