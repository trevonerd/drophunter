import type { CSSProperties } from 'react';
import { getGameDisplayLabel } from '../../shared/game-selection';
import { formatStopReason, type RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop } from '../../types';
import type { CampaignSyncStatus } from '../constants';
import { formatEtaMinutes, recoveryAttemptLabel, retryLabel, statusReasonLabel } from '../format';
import { CompactDropCard } from './DropCard';

type SessionSummaryMode = 'ready' | 'running' | 'paused' | 'recovering' | 'complete' | 'attention-required';

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

export interface SessionSummaryProps {
  state: AppState;
  runtimeMode: RuntimeMode;
  campaignSyncStatus: CampaignSyncStatus;
  currentAutomatableDrop: TwitchDrop | null;
  recoveryNow: number;
}

function campaignSubject(state: AppState): string {
  return state.selectedGame ? getGameDisplayLabel(state.selectedGame) : 'No campaign selected';
}

function rewardSubject(state: AppState, currentDrop: TwitchDrop | null): string {
  const campaign = state.selectedGame ? getGameDisplayLabel(state.selectedGame) : null;
  return [campaign, currentDrop?.name].filter((value): value is string => Boolean(value)).join(' · ');
}

function trackedProgress(drop: TwitchDrop): number {
  return Math.max(0, Math.min(100, drop.progress));
}

function createSessionSummaryModel({
  state,
  runtimeMode,
  campaignSyncStatus,
  currentAutomatableDrop,
  recoveryNow,
}: SessionSummaryProps): SessionSummaryModel {
  const subject = rewardSubject(state, currentAutomatableDrop) || campaignSubject(state);

  if (campaignSyncStatus === 'signed-out') {
    return {
      mode: 'attention-required',
      progressState: 'unavailable',
      label: 'Attention required',
      subject: 'Twitch session unavailable',
      detail: 'Sign in to Twitch below to sync campaigns and start farming.',
      tone: 'accent',
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
      detail: `${recoveryParts.join(' · ') || 'Restoring the farming session'}. Progress is paused; DropHunter will retry automatically.`,
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
        ? `Progress is paused at ${trackedProgress(currentAutomatableDrop)}%. Resume when ready.`
        : 'The farming session is paused. Resume when ready.',
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
        mode: 'ready',
        progressState: 'waiting',
        label: 'Ready',
        subject: campaignSubject(state),
        detail: 'The previous farming session was stopped. Start again when ready.',
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

  if (campaignSyncStatus === 'failed') {
    return {
      mode: 'attention-required',
      progressState: 'unavailable',
      label: 'Attention required',
      subject: campaignSubject(state),
      detail: 'Campaign sync failed. Retry from the panel below.',
      tone: 'danger',
    };
  }

  if (campaignSyncStatus === 'empty') {
    return {
      mode: 'attention-required',
      progressState: 'unavailable',
      label: 'Attention required',
      subject: 'No active campaigns',
      detail: 'Open Twitch Drops below to check for active campaigns.',
      tone: 'accent',
    };
  }

  if (campaignSyncStatus === 'syncing' || campaignSyncStatus === 'stale') {
    return {
      mode: 'ready',
      progressState: 'waiting',
      label: 'Getting ready',
      subject: campaignSubject(state),
      detail: 'Refreshing campaigns before the next farming session.',
      tone: 'neutral',
    };
  }

  return {
    mode: 'ready',
    progressState: 'waiting',
    label: 'Ready',
    subject: campaignSubject(state),
    detail: state.selectedGame
      ? 'This campaign is ready. Press Start to begin farming.'
      : 'Select a campaign to begin.',
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

  if (model.mode === 'running' && props.currentAutomatableDrop) {
    return (
      <section
        className="dh-panel dh-contain overflow-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Current farming reward"
        data-session-mode={model.mode}
        data-progress-state={model.progressState}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-xs font-bold text-green-300">Running</h2>
        </div>
        <CompactDropCard drop={props.currentAutomatableDrop} />
      </section>
    );
  }

  const progress = props.currentAutomatableDrop ? trackedProgress(props.currentAutomatableDrop) : null;
  const progressStyle: ProgressStyle | null = progress === null ? null : { '--dh-progress': progress / 100 };
  const showLiveProgress =
    progress !== null && progressStyle !== null && (model.mode === 'paused' || model.mode === 'recovering');

  return (
    <section
      className={`dh-contain rounded-lg border px-3 py-2.5 ${toneClasses[model.tone]}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Current farming session"
      data-session-mode={model.mode}
      data-progress-state={model.progressState}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <p className={`text-xs font-bold ${labelClasses[model.tone]}`}>{model.label}</p>
        <p className="min-w-0 truncate text-right text-xs font-semibold text-[color:var(--dh-text)]">
          {model.subject}
        </p>
      </div>
      <p className="mt-1 text-xs leading-snug text-[color:var(--dh-text-soft)]">{model.detail}</p>
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
    </section>
  );
}
