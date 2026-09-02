// Extracted from src/popup/App.tsx (settings view markup).
import { browser } from '../../shared/browser-api.ts';
import { STREAMER_LANGUAGE_OPTIONS, STREAMER_SELECTION_OPTIONS } from '../constants';
import { FarmingAutomationSettings } from './FarmingAutomationSettings';
import { BackIcon, CoffeeIcon, GitHubIcon } from './icons';
import { SettingRow } from './SettingRow';
import { SettingsStatistics } from './SettingsStatistics';
import type { SettingsViewProps } from './settings-view-types';
import { TelegramSettingsSection } from './TelegramSettingsSection';

export type { SettingsViewProps } from './settings-view-types';

function extensionVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return 'dev';
  }
}

export function SettingsView({
  state,
  onBack,
  onOpenClaimLog,
  onMonitorAutoOpenToggle,
  onMuteFarmingTabToggle,
  onNotificationsEnabledToggle,
  notificationPermissionDenied,
  onTelegramAlertsToggle,
  onTelegramSystemAlertsToggle,
  onSaveTelegramCredentials,
  onTestTelegramAlerts,
  onLoadTelegramSettings,
  onAutoClaimChannelPointsBonusToggle,
  onAutoClaimDropsToggle,
  onStreamerSelectionModeChange,
  onPreferredStreamerLanguageChange,
  onFarmCategoryScopeChange,
  onWatchTransportModeChange,
}: SettingsViewProps) {
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
        <div className="dh-group">
          <SettingRow
            title="Auto-open monitor"
            description="Open the DropHunter monitor shortly after farming starts."
            checked={state.monitorAutoOpen}
            ariaLabel="Auto-open monitor"
            onToggle={onMonitorAutoOpenToggle}
          />
          <SettingRow
            title="Mute farming tab"
            description="Keep the Twitch farming tab muted."
            checked={state.muteFarmingTab}
            ariaLabel="Mute farming tab"
            onToggle={onMuteFarmingTabToggle}
          />
          <TelegramSettingsSection
            enabled={state.telegramAlertsEnabled}
            onToggle={onTelegramAlertsToggle}
            systemAlertsEnabled={state.telegramSystemAlertsEnabled}
            onSystemAlertsToggle={onTelegramSystemAlertsToggle}
            onSaveCredentials={onSaveTelegramCredentials}
            onTestAlerts={onTestTelegramAlerts}
            onLoadSettings={onLoadTelegramSettings}
          />
          <SettingRow
            title="Auto-claim channel points"
            description="Claim free channel points bonuses on open Twitch channel tabs."
            checked={state.autoClaimChannelPointsBonus}
            ariaLabel="Auto-claim channel points"
            onToggle={onAutoClaimChannelPointsBonusToggle}
          />
          <SettingRow
            title="Auto-claim Twitch Drops"
            description="Automatically claim completed Drops across all campaigns."
            checked={state.autoClaimDrops}
            ariaLabel="Auto-claim Twitch Drops"
            onToggle={onAutoClaimDropsToggle}
          />
        </div>
        <div className="dh-panel dh-contain px-3 py-2.5">
          <p className="dh-title text-xs">Streamer selection</p>
          <p className="dh-copy mt-1 text-[11px] leading-snug">
            Prefer smaller channels, rotate randomly, or prioritize the biggest live channels.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {STREAMER_SELECTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={state.streamerSelectionMode === option.value}
                onClick={() => onStreamerSelectionModeChange(option.value)}
                className={`dh-focus rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  state.streamerSelectionMode === option.value
                    ? 'border-purple-300/70 bg-purple-400/20 text-[color:var(--dh-text)]'
                    : 'border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] text-[color:var(--dh-text-soft)] hover:border-[color:var(--dh-border-strong)] hover:text-[color:var(--dh-text)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dh-panel dh-contain px-3 py-2.5">
          <div className="dh-setting-control-row flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="dh-title text-xs">Preferred streamer language</p>
              <p className="dh-copy mt-1 text-[11px] leading-snug">
                If available, prefer streamers in this language. If none are live, DropHunter falls back
                automatically.
              </p>
            </div>
            <select
              aria-label="Preferred streamer language"
              value={state.preferredStreamerLanguage ?? ''}
              onChange={(event) => onPreferredStreamerLanguageChange(event.target.value)}
              className="dh-input dh-setting-select min-w-[92px] shrink-0 rounded-md px-2 py-1.5 text-[11px] font-semibold"
            >
              {STREAMER_LANGUAGE_OPTIONS.map((option) => (
                <option
                  key={option.value || 'any'}
                  value={option.value}
                  className="bg-twitch-dark text-[color:var(--dh-text)]"
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-300/80">About</p>
        </div>
        <p className="text-sm font-bold text-[color:var(--dh-text)]">
          DropHunter <span className="text-purple-300 font-normal">v{extensionVersion()}</span>
        </p>
        <p className="dh-copy text-[11px]">
          by{' '}
          <a
            href="https://www.marcotrevisani.com"
            target="_blank"
            rel="noopener noreferrer"
            className="dh-focus cursor-pointer rounded text-[color:var(--dh-text-soft)] no-underline transition-colors hover:text-[color:var(--dh-text)]"
          >
            Marco Trevisani
          </a>{' '}
          (
          <a
            href="https://github.com/trevonerd"
            target="_blank"
            rel="noopener noreferrer"
            className="dh-focus cursor-pointer rounded text-[color:var(--dh-text-soft)] no-underline transition-colors hover:text-[color:var(--dh-text)]"
          >
            trevonerd
          </a>
          )
        </p>
        <a
          href="https://trevisoft.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="dh-focus cursor-pointer rounded text-[11px] font-semibold tracking-wide text-purple-300 no-underline transition-colors hover:text-purple-100"
        >
          TREVISOFT
        </a>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({ url: 'https://github.com/trevonerd/drophunter' }).catch(() => {})
            }
            className="dh-focus flex cursor-pointer items-center gap-1.5 rounded text-[11px] text-[color:var(--dh-text-soft)] transition-colors hover:text-[color:var(--dh-text)]"
            aria-label="Open DropHunter GitHub repository"
          >
            <GitHubIcon />
            GitHub
          </button>
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({ url: 'https://buymeacoffee.com/trevonerd' }).catch(() => {})
            }
            className="dh-coffee-button dh-focus flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
            aria-label="Open Buy Me a Coffee"
          >
            <CoffeeIcon />
            Buy Me a Coffee
          </button>
        </div>
      </main>
    </div>
  );
}
