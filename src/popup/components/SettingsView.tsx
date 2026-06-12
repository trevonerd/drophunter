// Extracted from src/popup/App.tsx (settings view markup).
import { browser } from '../../shared/browser-api.ts';
import type { AppState, StreamerSelectionMode } from '../../types';
import { STREAMER_LANGUAGE_OPTIONS, STREAMER_SELECTION_OPTIONS } from '../constants';
import { BackIcon, CoffeeIcon, GitHubIcon, HistoryIcon } from './icons';

export interface SettingsViewProps {
  state: AppState;
  onBack: () => void;
  onOpenClaimLog: () => void;
  onMonitorAutoOpenToggle: () => void;
  onMuteFarmingTabToggle: () => void;
  onNotificationsEnabledToggle: () => void;
  onAutoResumeOnStartupToggle: () => void;
  onAutoClaimChannelPointsBonusToggle: () => void;
  onAutoClaimDropsToggle: () => void;
  onStreamerSelectionModeChange: (mode: StreamerSelectionMode) => void;
  onPreferredStreamerLanguageChange: (language: string) => void;
}

export function SettingsView({
  state,
  onBack,
  onOpenClaimLog,
  onMonitorAutoOpenToggle,
  onMuteFarmingTabToggle,
  onNotificationsEnabledToggle,
  onAutoResumeOnStartupToggle,
  onAutoClaimChannelPointsBonusToggle,
  onAutoClaimDropsToggle,
  onStreamerSelectionModeChange,
  onPreferredStreamerLanguageChange,
}: SettingsViewProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-[#B286FF] via-[#A970FF] to-[#8F4CFF]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded p-1 text-[#1B1030] hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B1030]/70"
            aria-label="Back to main view"
            title="Back"
          >
            <BackIcon />
          </button>
          <h1 className="font-extrabold text-sm tracking-tight text-[#120B22]">Settings</h1>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#24133D]/80">
          DropHunter
        </span>
      </div>

      <div className="px-4 py-3 space-y-2 bg-gradient-to-br from-[#0E0E10] via-twitch-dark to-twitch-dark-light">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-white">Statistics</p>
            <button
              type="button"
              onClick={onOpenClaimLog}
              aria-label="View drop claim log"
              title="Drop claim log"
              className="rounded p-1 text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
            >
              <HistoryIcon />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-black/20 px-2.5 py-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Drops claimed</p>
              <p className="mt-0.5 text-lg font-bold text-white leading-none">{state.totalDropsClaimed}</p>
            </div>
            <div className="rounded-md bg-black/20 px-2.5 py-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Channel points claimed</p>
              <p className="mt-0.5 text-lg font-bold text-white leading-none">
                {state.totalChannelPointsClaimed}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Auto-open monitor</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Open the Drop Hunter Monitor shortly after farming starts.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.monitorAutoOpen}
              aria-label="Auto-open monitor"
              onClick={onMonitorAutoOpenToggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                state.monitorAutoOpen ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.monitorAutoOpen ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Mute farming tab</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Keep the Twitch tab used for farming muted. Disable this if you want to listen to the live
                stream.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.muteFarmingTab}
              aria-label="Mute farming tab"
              onClick={onMuteFarmingTabToggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                state.muteFarmingTab ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.muteFarmingTab ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Notifications</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Show desktop alerts for channel points and farming events.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.notificationsEnabled}
              aria-label="Notifications"
              onClick={onNotificationsEnabledToggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                state.notificationsEnabled ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Auto-resume after restart</p>
              <p className="mt-1 text-[11px] text-gray-400">
                After 30 seconds away, resume farming automatically instead of returning paused.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.autoResumeOnStartup}
              aria-label="Auto-resume after restart"
              onClick={onAutoResumeOnStartupToggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                state.autoResumeOnStartup ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.autoResumeOnStartup ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Auto-claim channel points bonus</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Claim free bonus points on every open Twitch channel tab.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.autoClaimChannelPointsBonus}
              aria-label="Auto-claim channel points bonus"
              onClick={onAutoClaimChannelPointsBonusToggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                state.autoClaimChannelPointsBonus ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.autoClaimChannelPointsBonus ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Auto-claim drops</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Automatically claim completed drops across all campaigns.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.autoClaimDrops}
              aria-label="Auto-claim drops"
              onClick={onAutoClaimDropsToggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                state.autoClaimDrops ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.autoClaimDrops ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <p className="text-xs font-semibold text-white">Streamer selection</p>
          <p className="mt-1 text-[11px] text-gray-400">
            Prefer smaller channels, rotate randomly, or prioritize the biggest live channels.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {STREAMER_SELECTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={state.streamerSelectionMode === option.value}
                onClick={() => onStreamerSelectionModeChange(option.value)}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 ${
                  state.streamerSelectionMode === option.value
                    ? 'border-purple-300/70 bg-purple-400/20 text-white'
                    : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/20 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Preferred streamer language</p>
              <p className="mt-1 text-[11px] text-gray-400">
                If available, prefer streamers in this language. If none are live, DropHunter falls back
                automatically.
              </p>
            </div>
            <select
              aria-label="Preferred streamer language"
              value={state.preferredStreamerLanguage ?? ''}
              onChange={(event) => onPreferredStreamerLanguageChange(event.target.value)}
              className="min-w-[84px] rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] font-semibold text-white outline-none transition-colors hover:border-white/20 focus-visible:ring-2 focus-visible:ring-purple-300"
            >
              {STREAMER_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value || 'any'} value={option.value} className="bg-[#0E0E10] text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-300/80">About</p>
        </div>
        <p className="text-sm font-bold text-white">
          DropHunter{' '}
          <span className="text-purple-300 font-normal">v{browser.runtime.getManifest().version}</span>
        </p>
        <p className="text-[11px] text-gray-400">
          by{' '}
          <a
            href="https://www.marcotrevisani.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-200 cursor-pointer no-underline hover:text-white transition-colors"
          >
            Marco Trevisani
          </a>{' '}
          (
          <a
            href="https://github.com/trevonerd"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-200 cursor-pointer no-underline hover:text-white transition-colors"
          >
            trevonerd
          </a>
          )
        </p>
        <a
          href="https://trevisoft.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-purple-300 font-semibold tracking-wide cursor-pointer no-underline hover:text-purple-100 transition-colors"
        >
          TREVISOFT
        </a>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({ url: 'https://github.com/trevonerd/drophunter' }).catch(() => {})
            }
            className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 rounded"
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
            className="flex items-center gap-1.5 rounded-full bg-[#FFDD00]/90 hover:bg-[#FFDD00] px-2.5 py-1 text-[11px] font-semibold text-[#1a1a1a] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
            aria-label="Open Buy Me a Coffee"
          >
            <CoffeeIcon />
            Buy Me a Coffee
          </button>
        </div>
      </div>
    </div>
  );
}
