import { AdvancedSettings } from './AdvancedSettings.tsx';
import { FarmingAutomationSettings } from './FarmingAutomationSettings.tsx';
import { BackIcon } from './icons.tsx';
import { SettingsAbout } from './SettingsAbout.tsx';
import { SettingsStatistics } from './SettingsStatistics.tsx';
import type { SettingsViewProps } from './settings-view-types.ts';

export type { SettingsViewProps } from './settings-view-types.ts';

export function SettingsView(props: SettingsViewProps) {
  const {
    state,
    onBack,
    onOpenClaimLog,
    onNotificationsEnabledToggle,
    notificationPermissionDenied,
    onFarmCategoryScopeChange,
    onWatchTransportModeChange,
  } = props;

  return (
    <div className="flex flex-col">
      <header className="dh-header flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="dh-icon-button dh-focus text-[color:var(--dh-accent-ink)]"
            aria-label="Back to main view"
            title="Back"
          >
            <BackIcon />
          </button>
          <h1 className="font-extrabold text-sm text-[color:var(--dh-accent-ink)]">Settings</h1>
        </div>
        <span className="dh-header-label text-[10px] font-semibold uppercase tracking-[0.14em]">
          DropHunter
        </span>
      </header>

      <main className="dh-view dh-page dh-page--wide">
        <SettingsStatistics
          dropsClaimed={state.totalDropsClaimed}
          channelPointsClaimed={state.totalChannelPointsClaimed}
          onOpenClaimLog={onOpenClaimLog}
        />
        <FarmingAutomationSettings
          state={state}
          notificationPermissionDenied={notificationPermissionDenied}
          onNotificationsEnabledToggle={onNotificationsEnabledToggle}
          onFarmCategoryScopeChange={onFarmCategoryScopeChange}
          onWatchTransportModeChange={onWatchTransportModeChange}
        />
        <AdvancedSettings {...props} />
        <SettingsAbout />
      </main>
    </div>
  );
}
