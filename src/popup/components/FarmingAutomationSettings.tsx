import type { AppState, FarmCategoryScope, WatchTransportMode } from '../../types';
import { SettingRow } from './SettingRow';

interface FarmingAutomationSettingsProps {
  readonly state: AppState;
  readonly favoriteCount: number;
  readonly notificationPermissionDenied?: boolean;
  readonly onNotificationsEnabledToggle: () => void;
  readonly onAutoStartFavoriteGamesToggle?: () => void | Promise<void>;
  readonly onFarmCategoryScopeChange?: (scope: FarmCategoryScope) => void;
  readonly onWatchTransportModeChange?: (mode: WatchTransportMode) => void;
}

function isFarmCategoryScope(value: string): value is FarmCategoryScope {
  return value === 'all' || value === 'favorites-only';
}

function isWatchTransportMode(value: string): value is WatchTransportMode {
  return value === 'tabless' || value === 'managed-tab';
}

export function FarmingAutomationSettings({
  state,
  favoriteCount,
  notificationPermissionDenied,
  onNotificationsEnabledToggle,
  onAutoStartFavoriteGamesToggle,
  onFarmCategoryScopeChange,
  onWatchTransportModeChange,
}: FarmingAutomationSettingsProps) {
  return (
    <section className="dh-panel dh-contain px-3 py-2.5" aria-labelledby="farming-automation-heading">
      <div className="dh-setting-section-header flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="farming-automation-heading" className="dh-title text-xs">
            Farming automation
          </h2>
          <p className="dh-copy mt-1 text-[11px] leading-snug">
            Automatically discover and farm favorite-game campaigns while the browser is open.
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-[color:var(--dh-muted)]">
          {favoriteCount} favorite {favoriteCount === 1 ? 'game' : 'games'}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        <SettingRow
          title="Auto-start favorite games"
          description="Automatically start newly discovered campaigns for your favorite games. Notifications are required."
          checked={state.autoStartFavoriteGames}
          ariaLabel="Auto-start favorite games"
          onToggle={() => onAutoStartFavoriteGamesToggle?.()}
          warning={
            notificationPermissionDenied
              ? 'Notifications are required for auto-start. Allow them in your browser settings, then try again.'
              : null
          }
        />
        <div className="dh-subpanel px-2.5 py-2">
          <div className="dh-setting-control-row flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="dh-title text-xs">Farm categories</p>
              <p className="dh-copy mt-1 text-[11px] leading-snug">Limit automatic farming.</p>
            </div>
            <select
              aria-label="Farm categories"
              value={state.farmCategoryScope}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isFarmCategoryScope(value)) onFarmCategoryScopeChange?.(value);
              }}
              disabled={!onFarmCategoryScopeChange}
              className="dh-input dh-setting-select min-w-[132px] shrink-0 rounded-md px-2 py-1.5 text-[11px] font-semibold disabled:opacity-70"
            >
              <option value="all">All active campaigns</option>
              <option value="favorites-only">Favorite games only</option>
            </select>
          </div>
        </div>
        <div className="dh-subpanel px-2.5 py-2">
          <div className="dh-setting-control-row flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="dh-title text-xs">Watch mode</p>
              <p className="dh-copy mt-1 text-[11px] leading-snug">Choose how DropHunter watches Twitch.</p>
            </div>
            <select
              aria-label="Watch mode"
              value={state.watchTransportPreference}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isWatchTransportMode(value)) onWatchTransportModeChange?.(value);
              }}
              disabled={!onWatchTransportModeChange || state.isRunning}
              className="dh-input dh-setting-select min-w-[132px] shrink-0 rounded-md px-2 py-1.5 text-[11px] font-semibold disabled:opacity-70"
            >
              <option value="tabless">Tabless heartbeat</option>
              <option value="managed-tab">Managed tab</option>
            </select>
          </div>
          <p className="mt-1.5 text-[10px] text-[color:var(--dh-muted)]">
            {state.watchTransportPreference === 'tabless'
              ? 'Farms without opening a stream tab. Falls back to a managed tab when heartbeat health fails.'
              : 'Uses a muted inactive tab, retries playback automatically, and never takes focus.'}
          </p>
          {state.isRunning && (
            <p className="mt-1 text-[10px] text-[color:var(--dh-muted)]">
              Stop farming to change watch mode.
            </p>
          )}
        </div>
        <div className="dh-subpanel px-2.5 py-2">
          <p className="dh-title text-xs">Favorite games ({favoriteCount})</p>
          <p className="dh-copy mt-1 text-[11px] leading-snug">
            New farmable campaigns from these Twitch categories can be queued automatically.
          </p>
          {favoriteCount === 0 && (
            <p className="mt-1 text-[10px] text-[color:var(--dh-muted)]">No favorite games yet.</p>
          )}
        </div>
        <SettingRow
          title="Notifications"
          description="Show desktop alerts for farming and automation events."
          checked={state.notificationsEnabled}
          ariaLabel="Notifications"
          onToggle={onNotificationsEnabledToggle}
          warning={
            notificationPermissionDenied
              ? 'Browser permission was denied. Allow notifications for this extension in your browser settings, then try again.'
              : null
          }
        />
      </div>
    </section>
  );
}
