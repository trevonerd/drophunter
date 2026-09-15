import type { RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop } from '../../types';
import { CompactDropCard } from './DropCard';
import { EyeOffIcon, MonitorIcon } from './icons';
import { SelectedCampaignStatus } from './SelectedCampaignStatus';
import { remainingSessionDrops } from './session-drops';
import {
  createSessionSummaryModel,
  effectiveTransport,
  type SessionSummaryModel,
} from './session-summary-model';

export interface SessionSummaryProps {
  state: AppState;
  runtimeMode: RuntimeMode;
  currentAutomatableDrop: TwitchDrop | null;
  recoveryNow: number;
  actionLoading: boolean;
  startDisabled: boolean;
  automaticStartPending?: boolean;
  showSelectedCampaignStatus: boolean;
  queueCount: number;
  startHighlighted: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenTwitch: () => void;
}

const toneClasses: Record<SessionSummaryModel['tone'], string> = {
  neutral: 'border-[color:var(--dh-border)] bg-[color:var(--dh-surface-2)]',
  success: 'border-green-500/30 bg-green-500/10',
  warning: 'border-yellow-500/30 bg-yellow-500/10',
  danger: 'border-red-500/35 bg-red-500/10',
  accent: 'border-purple-500/35 bg-purple-500/10',
};

const labelClasses: Record<SessionSummaryModel['tone'], string> = {
  neutral: 'text-[color:var(--dh-text-soft)]',
  success: 'text-green-300',
  warning: 'text-yellow-300',
  danger: 'text-red-300',
  accent: 'text-purple-300',
};

export function SessionSummary(props: SessionSummaryProps) {
  const model = createSessionSummaryModel(props);
  const transport = effectiveTransport(props.state);
  const remainingDrops = remainingSessionDrops(props.state);
  const isRunning = model.mode === 'running';
  const isPaused = model.mode === 'paused';
  const isRecovering = model.mode === 'recovering';
  const showDrops = (isRunning || isPaused || isRecovering) && remainingDrops.length > 0;
  const needsTwitch =
    model.mode === 'attention-required' && props.state.lastStopReason === 'sign-in-required';
  const canStart = !isRunning && !isPaused && !isRecovering && !needsTwitch && !props.automaticStartPending;
  const continuationNote = props.state.manualQueueAuthorized
    ? isPaused
      ? 'The started queue is saved and will continue after Resume.'
      : 'The started queue will continue automatically, including campaigns added manually.'
    : props.state.autoStartFavoriteGames
      ? 'Favorite auto-start remains enabled and may resume farming at the next check.'
      : null;
  const startLabel = props.actionLoading
    ? 'Starting…'
    : props.queueCount > 0
      ? `Start Queue (${props.queueCount})`
      : 'Start Farming';

  return (
    <section
      className={`dh-contain overflow-hidden rounded-lg border ${
        isRunning ? 'dh-panel-strong' : toneClasses[model.tone]
      }`}
      aria-label="Current farming session"
      data-session-mode={model.mode}
      data-progress-state={model.progressState}
      data-startup-continuation={props.automaticStartPending ? 'automatic' : undefined}
    >
      <div className="px-3 py-2.5" role="status" aria-live="polite" aria-atomic="true">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className={`min-w-0 flex-1 break-words text-xs font-bold ${labelClasses[model.tone]}`}>
            {model.label} <span className="text-[color:var(--dh-muted)]">·</span>{' '}
            <span className="text-[color:var(--dh-text)]">{model.subject}</span>
          </p>
          {transport && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--dh-border)] bg-[color:var(--dh-surface-3)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--dh-text-soft)]"
              data-watch-transport={transport.mode}
              role="img"
              aria-label={transport.label}
            >
              {transport.icon === 'eye-off' ? <EyeOffIcon /> : <MonitorIcon />}
              <span>{transport.label}</span>
            </span>
          )}
        </div>
        {props.showSelectedCampaignStatus && (
          <SelectedCampaignStatus selectedGame={props.state.selectedGame} />
        )}
        {!isRunning && model.detail && (
          <p className="mt-1 text-[11px] leading-snug text-[color:var(--dh-text-soft)]">{model.detail}</p>
        )}
        {isRunning && !props.currentAutomatableDrop && (
          <p className="mt-1 text-[11px] leading-snug text-[color:var(--dh-text-soft)]">{model.detail}</p>
        )}
        {showDrops && (
          <p className="mt-1 text-[11px] text-[color:var(--dh-text-soft)]">
            {`${remainingDrops.length} ${remainingDrops.length === 1 ? 'drop' : 'drops'} remaining`}
          </p>
        )}
      </div>
      {showDrops && (
        <ul className="border-t border-[color:var(--dh-border)]" aria-label="Remaining campaign drops">
          {remainingDrops.map((drop) => (
            <li key={`${drop.campaignId ?? drop.gameId}:${drop.id}`}>
              <CompactDropCard drop={drop} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5 border-t border-[color:var(--dh-border)] px-3 py-2">
        {canStart && (
          <button
            type="button"
            onClick={props.onStart}
            disabled={props.actionLoading || props.startDisabled}
            className={`dh-focus inline-flex min-h-8 flex-1 items-center justify-center rounded-lg bg-twitch-purple/70 px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/75 disabled:cursor-not-allowed disabled:opacity-45 ${
              props.startHighlighted ? 'onboarding-pulse' : ''
            }`}
          >
            {startLabel}
          </button>
        )}
        {isRunning && (
          <button
            type="button"
            onClick={props.onPause}
            disabled={props.actionLoading}
            className="dh-focus min-h-8 flex-1 rounded-lg border border-[color:var(--dh-border-strong)] px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)] disabled:opacity-45"
          >
            Pause
          </button>
        )}
        {isPaused && (
          <button
            type="button"
            onClick={props.onResume}
            disabled={props.actionLoading}
            className="dh-focus min-h-8 flex-1 rounded-lg bg-twitch-purple/70 px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)] disabled:opacity-45"
          >
            Resume
          </button>
        )}
        {(isRunning || isPaused || isRecovering || props.automaticStartPending) && (
          <button
            type="button"
            onClick={props.onStop}
            disabled={props.actionLoading}
            className="dh-focus min-h-8 flex-1 rounded-lg border border-red-500/35 px-3 py-1.5 text-xs font-semibold text-red-300 disabled:opacity-45"
          >
            Stop
          </button>
        )}
        {needsTwitch && (
          <button
            type="button"
            onClick={props.onOpenTwitch}
            className="dh-focus min-h-8 flex-1 rounded-lg bg-twitch-purple/70 px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)]"
          >
            Open Twitch
          </button>
        )}
      </div>
      {continuationNote && (isRunning || isPaused || isRecovering) && (
        <p className="border-t border-[color:var(--dh-border)] px-3 py-1.5 text-[10px] leading-snug text-[color:var(--dh-muted)]">
          {continuationNote}
        </p>
      )}
    </section>
  );
}
