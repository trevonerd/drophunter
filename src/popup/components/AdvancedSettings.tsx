import { STREAMER_LANGUAGE_OPTIONS, STREAMER_SELECTION_OPTIONS } from '../constants.ts';
import { SettingRow } from './SettingRow.tsx';
import { SettingsStatistics } from './SettingsStatistics.tsx';
import type { SettingsViewProps } from './settings-view-types.ts';
import { TelegramSettingsSection } from './TelegramSettingsSection.tsx';

type AdvancedSettingsProps = Pick<
  SettingsViewProps,
  | 'state'
  | 'onOpenClaimLog'
  | 'onMonitorAutoOpenToggle'
  | 'onMuteFarmingTabToggle'
  | 'onTelegramAlertsToggle'
  | 'onTelegramSystemAlertsToggle'
  | 'onSaveTelegramCredentials'
  | 'onTestTelegramAlerts'
  | 'onLoadTelegramSettings'
  | 'onAutoClaimChannelPointsBonusToggle'
  | 'onAutoClaimDropsToggle'
  | 'onStreamerSelectionModeChange'
  | 'onPreferredStreamerLanguageChange'
>;

export function AdvancedSettings({
  state,
  onOpenClaimLog,
  onMonitorAutoOpenToggle,
  onMuteFarmingTabToggle,
  onTelegramAlertsToggle,
  onTelegramSystemAlertsToggle,
  onSaveTelegramCredentials,
  onTestTelegramAlerts,
  onLoadTelegramSettings,
  onAutoClaimChannelPointsBonusToggle,
  onAutoClaimDropsToggle,
  onStreamerSelectionModeChange,
  onPreferredStreamerLanguageChange,
}: AdvancedSettingsProps) {
  return (
    <details className="dh-panel dh-contain">
      <summary className="dh-focus cursor-pointer rounded-md px-3 py-2.5 text-xs font-semibold text-[color:var(--dh-text)]">
        Advanced settings
      </summary>
      <div className="dh-group px-3 pb-2.5 pt-1">
        <section className="dh-group" aria-labelledby="advanced-rewards-heading">
          <h2 id="advanced-rewards-heading" className="dh-title text-xs">
            Rewards and history
          </h2>
          <SettingsStatistics
            dropsClaimed={state.totalDropsClaimed}
            channelPointsClaimed={state.totalChannelPointsClaimed}
            onOpenClaimLog={onOpenClaimLog}
          />
          <SettingRow
            title="Auto-claim Twitch Drops"
            description="Automatically claim completed Drops across all campaigns."
            checked={state.autoClaimDrops}
            ariaLabel="Auto-claim Twitch Drops"
            onToggle={onAutoClaimDropsToggle}
          />
          <SettingRow
            title="Auto-claim channel points"
            description="Claim free channel points bonuses on open Twitch channel tabs."
            checked={state.autoClaimChannelPointsBonus}
            ariaLabel="Auto-claim channel points"
            onToggle={onAutoClaimChannelPointsBonusToggle}
          />
        </section>
        <section className="dh-group" aria-labelledby="advanced-playback-heading">
          <h2 id="advanced-playback-heading" className="dh-title text-xs">
            Playback and monitor
          </h2>
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
                  Prefer this language when available. DropHunter falls back automatically.
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
        </section>
        <details>
          <summary className="dh-focus cursor-pointer rounded-md py-2 text-xs font-semibold text-[color:var(--dh-text)]">
            Telegram alerts
          </summary>
          <TelegramSettingsSection
            enabled={state.telegramAlertsEnabled}
            onToggle={onTelegramAlertsToggle}
            systemAlertsEnabled={state.telegramSystemAlertsEnabled}
            onSystemAlertsToggle={onTelegramSystemAlertsToggle}
            onSaveCredentials={onSaveTelegramCredentials}
            onTestAlerts={onTestTelegramAlerts}
            onLoadSettings={onLoadTelegramSettings}
          />
        </details>
      </div>
    </details>
  );
}
