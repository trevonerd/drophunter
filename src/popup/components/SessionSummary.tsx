import type { CSSProperties } from 'react';
import { getGameDisplayLabel } from '../../shared/game-selection';
import { formatStopReason, type RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop } from '../../types';
import { formatEtaMinutes, recoveryAttemptLabel, retryLabel, statusReasonLabel } from '../format';
import { CompactDropCard } from './DropCard';
import { EyeOffIcon, MonitorIcon } from './icons';

type SessionSummaryMode =
  | 'ready'
  | 'running'
  | 'paused'
  | 'recovering'
  | 'stopped'
  | 'complete'
  | 'attention-required';

type ProgressState = 'waiting' | 'tracking' | 'paused' | 'recovering' | 'complete' | 'unavailable';
type ProgressStyle = CSSProperties & Record<'--dh-progress', number>;

type SessionSummaryModel = {
  mode: SessionSummaryMode;
  progressState: ProgressState;
  label: string;
  subject: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
};

type EffectiveTransport = {
  readonly mode: 'hidden' | 'tab' | 'manual-tab';
  readonly label: 'Hidden' | 'Tab' | 'Manual tab';
  readonly icon: 'eye-off' | 'monitor';
};

export interface SessionSummaryProps {
  state: AppState;
  runtimeMode: RuntimeMode;
  currentAutomatableDrop: TwitchDrop | null;
  recoveryNow: number;
  actionLoading: boolean;
  startDisabled: boolean;
  queueCount: number;
  startHighlighted: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenTwitch: () => void;
}

function campaignSubject(state: AppState): string {
  return state.selectedGame ? getGameDisplayLabel(state.selectedGame) : 'No campaign selected';
}

function trackedProgress(drop: TwitchDrop): number {
  return Math.max(0, Math.min(100, drop.progress));
}

function effectiveTransport(state: AppState): EffectiveTransport | null {
  if (!state.isRunning) return null;
  if ((state.manualWatchState ?? 'inactive') !== 'inactive') {
    return { mode: 'manual-tab', label: 'Manual tab', icon: 'monitor' };
  }
  switch (state.watchTransportMode) {
    case 'tabless':
      return { mode: 'hidden', label: 'Hidden', icon: 'eye-off' };
    case 'managed-tab':
      return { mode: 'tab', label: 'Tab', icon: 'monitor' };
  }
}

function createSessionSummaryModel({
  state,
  runtimeMode,
  currentAutomatableDrop,
  recoveryNow,
}: SessionSummaryProps): SessionSummaryModel {
  const subject = campaignSubject(state);
  const manualWatchState = state.manualWatchState ?? 'inactive';

  if (manualWatchState !== 'inactive' && runtimeMode === 'idle') {
    return {
      mode: 'ready',
      progressState: manualWatchState === 'eligible-manual' ? 'tracking' : 'waiting',
      label: 'Manual viewing',
      subject,
      detail:
        manualWatchState === 'eligible-manual'
          ? 'Twitch is advancing this campaign in your open tab. Automation will wait.'
          : 'Automation is waiting for manual viewing to end.',
      tone: 'neutral',
    };
  }

  if (runtimeMode === 'recovering') {
    const recoveryParts = [
      statusReasonLabel(state.recoveryReason),
      recoveryAttemptLabel(state.recoveryReason, state.recoveryAttempts),
      retryLabel(state.recoveryBackoffUntil, recoveryNow),
    ].filter((value): value is string => Boolean(value));
    return {
      mode: 'recovering',
      progressState: 'recovering',
      label: 'Recovering',
      subject,
      detail: `${recoveryParts.join(' · ') || 'Restoring the farming session'}. Progress is paused; retry is automatic.`,
      tone: 'warning',
    };
  }

  if (runtimeMode === 'paused') {
    return {
      mode: 'paused',
      progressState: 'paused',
      label: 'Paused',
      subject,
      detail: currentAutomatableDrop
        ? `Progress paused at ${trackedProgress(currentAutomatableDrop)}%.`
        : 'Farming is paused.',
      tone: 'warning',
    };
  }

  if (runtimeMode === 'running') {
    if (currentAutomatableDrop) {
      const eta = formatEtaMinutes(currentAutomatableDrop.remainingMinutes);
      return {
        mode: 'running',
        progressState: 'tracking',
        label: 'Running',
        subject,
        detail: `${trackedProgress(currentAutomatableDrop)}%${eta ? ` · ETA ${eta}` : ''}`,
        tone: 'success',
      };
    }
    return {
      mode: 'running',
      progressState: 'waiting',
      label: 'Running',
      subject,
      detail: state.activeStreamer
        ? `Watching ${state.activeStreamer.displayName}; waiting for Twitch progress.`
        : 'Finding an eligible streamer. DropHunter will start tracking progress automatically.',
      tone: 'success',
    };
  }

  if (runtimeMode === 'stopped-terminal') {
    const stopReason = formatStopReason(state.lastStopReason) ?? state.lastStopMessage ?? 'Farming stopped';
    if (state.lastStopReason === 'user-stop') {
      return {
        mode: 'stopped',
        progressState: 'waiting',
        label: 'Stopped',
        subject: campaignSubject(state),
        detail: '',
        tone: 'neutral',
      };
    }
    if (
      state.lastStopReason === 'sign-in-required' ||
      state.lastStopReason === 'stall-skipped' ||
      state.lastStopReason === 'no-active-campaigns'
    ) {
      return {
        mode: 'attention-required',
        progressState: 'unavailable',
        label: 'Attention required',
        subject: campaignSubject(state),
        detail: stopReason,
        tone: 'danger',
      };
    }
    return {
      mode: 'complete',
      progressState: 'complete',
      label: 'Complete',
      subject: campaignSubject(state),
      detail: stopReason,
      tone: 'success',
    };
  }

  return {
    mode: 'ready',
    progressState: 'waiting',
    label: 'Ready',
    subject: campaignSubject(state),
    detail: state.selectedGame ? '' : 'Choose a campaign below.',
    tone: 'neutral',
  };
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
  const progress = props.currentAutomatableDrop ? trackedProgress(props.currentAutomatableDrop) : null;
  const progressStyle: ProgressStyle | null = progress === null ? null : { '--dh-progress': progress / 100 };
  const showLiveProgress =
    progress !== null && progressStyle !== null && (model.mode === 'paused' || model.mode === 'recovering');
  const isRunning = model.mode === 'running';
  const isPaused = model.mode === 'paused';
  const isRecovering = model.mode === 'recovering';
  const needsTwitch =
    model.mode === 'attention-required' && props.state.lastStopReason === 'sign-in-required';
  const canStart = !isRunning && !isPaused && !isRecovering && !needsTwitch;
  const startLabel = props.actionLoading
    ? 'Starting…'
    : props.queueCount > 0
      ? `Start Queue (${props.queueCount})`
      : 'Start Farming';
  const crashRecoveryCopy =
    props.state.resumedFromCrash != null && (isRunning || isRecovering)
      ? 'Resumed after a browser interruption; checking progress.'
      : null;

  return (
    <section
      className={`dh-contain overflow-hidden rounded-lg border ${
        isRunning ? 'dh-panel-strong' : toneClasses[model.tone]
      }`}
      aria-label="Current farming session"
      data-session-mode={model.mode}
      data-progress-state={model.progressState}
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
        {!isRunning && model.detail && (
          <p className="mt-1 text-[11px] leading-snug text-[color:var(--dh-text-soft)]">{model.detail}</p>
        )}
        {crashRecoveryCopy && (
          <p className="mt-1 text-[10px] leading-snug text-yellow-300">{crashRecoveryCopy}</p>
        )}
        {isRunning && !props.currentAutomatableDrop && (
          <p className="mt-1 text-[11px] leading-snug text-[color:var(--dh-text-soft)]">{model.detail}</p>
        )}
        {showLiveProgress && props.currentAutomatableDrop && (
          <div
            className="dh-progress-track mt-2 h-1.5 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-label={`${props.currentAutomatableDrop.name} live progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="dh-progress-fill h-1.5 w-full rounded-full" style={progressStyle} />
          </div>
        )}
      </div>
      {isRunning && props.currentAutomatableDrop && (
        <div className="border-t border-[color:var(--dh-border)]">
          <CompactDropCard drop={props.currentAutomatableDrop} />
        </div>
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
        {(isRunning || isPaused || isRecovering) && (
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
    </section>
  );
}
