import type { AppState, TwitchDrop } from '../types';
import { gameKey, getGameDisplayLabel } from './game-selection';
import { getRecoveryPresentation, type RecoveryPresentation } from './recovery-presentation.ts';
import {
  formatEtaMinutes,
  formatRecoveryReason,
  formatRetryLabel,
  formatStopReason,
  type RuntimeMode,
} from './runtime-status';
import { classifyStartupPresentation } from './startup-presentation.ts';

export type UserStatusMode =
  | 'ready'
  | 'pending-validation'
  | 'running'
  | 'paused'
  | 'recovering'
  | 'stopped'
  | 'complete'
  | 'attention-required';

export type ProgressState = 'waiting' | 'tracking' | 'paused' | 'recovering' | 'complete' | 'unavailable';

export type UserStatusModel = {
  readonly mode: UserStatusMode;
  readonly progressState: ProgressState;
  readonly label: string;
  readonly badge: string;
  readonly subject: string;
  readonly detail: string;
  readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  readonly recovery?: RecoveryPresentation;
};

export type EffectiveTransport = {
  readonly mode: 'hidden' | 'tab' | 'manual-tab';
  readonly label: 'Hidden' | 'Tab' | 'Manual tab';
  readonly icon: 'eye-off' | 'monitor';
};

export type UserStatusModelInput = {
  readonly state: AppState;
  readonly runtimeMode: RuntimeMode;
  readonly currentAutomatableDrop: TwitchDrop | null;
  readonly recoveryNow: number;
  readonly automaticStartPending?: boolean;
};

function recoveryDetail(state: AppState, now: number): string {
  const recovery = getRecoveryPresentation(state, now);
  const reason = formatRecoveryReason(state.recoveryReason) ?? 'Restoring farming';
  const retry = formatRetryLabel(recovery?.nextRetryAt, now);
  const detail = retry ? `${reason} · ${retry}` : reason;
  return state.recoverySchedulerUnavailable
    ? `${detail} · Retry reminder unavailable; periodic checks continue.`
    : detail;
}

export function trackedProgress(drop: TwitchDrop): number {
  return Math.max(0, Math.min(100, drop.progress));
}

export function effectiveTransport(state: AppState): EffectiveTransport | null {
  if (!state.isRunning) return null;
  if (state.recoveryReason === 'no-streamers' || state.recoveryReason === 'directory-unavailable') {
    return null;
  }
  if ((state.manualWatchState ?? 'inactive') !== 'inactive') {
    return { mode: 'manual-tab', label: 'Manual tab', icon: 'monitor' };
  }
  if (!state.activeStreamer && state.tabId === null) return null;
  switch (state.watchTransportMode) {
    case 'tabless':
      return { mode: 'hidden', label: 'Hidden', icon: 'eye-off' };
    case 'managed-tab':
      return { mode: 'tab', label: 'Tab', icon: 'monitor' };
  }
}

export function createUserStatusModel({
  state,
  runtimeMode,
  currentAutomatableDrop,
  recoveryNow,
  automaticStartPending,
}: UserStatusModelInput): UserStatusModel {
  const subject = state.selectedGame ? getGameDisplayLabel(state.selectedGame) : 'No campaign selected';
  const manualWatchState = state.manualWatchState ?? 'inactive';
  const campaignSyncStatus = state.campaignSyncState?.status;

  if (manualWatchState !== 'inactive' && runtimeMode === 'idle') {
    return {
      mode: 'ready',
      progressState: manualWatchState === 'eligible-manual' ? 'tracking' : 'waiting',
      label: 'Manual viewing',
      badge: 'MANUAL',
      subject,
      detail:
        manualWatchState === 'eligible-manual'
          ? 'Twitch is tracking progress. Automation is waiting.'
          : 'Automation is waiting for manual viewing to end.',
      tone: 'neutral',
    };
  }

  if (
    state.isRunning &&
    runtimeMode !== 'paused' &&
    state.watchHealth?.reason === 'user-interaction-required'
  ) {
    return {
      mode: 'attention-required',
      progressState: 'waiting',
      label: 'Start the video',
      badge: 'ATTENTION',
      subject,
      detail: 'Click Play in the Twitch tab. Farming resumes when playback starts.',
      tone: 'warning',
    };
  }

  if (runtimeMode === 'recovering') {
    const queueRetry = state.queueAcquisitionRound !== null;
    const waiting =
      (state.queueAcquisitionRound?.nextRoundAt ?? state.recoveryBackoffUntil ?? 0) > recoveryNow;
    return {
      mode: 'recovering',
      progressState: 'recovering',
      label: queueRetry ? (waiting ? 'Waiting for next retry' : 'Attempt in progress') : 'Recovering',
      badge: queueRetry ? (waiting ? 'WAITING' : 'RETRYING') : 'RECOVERING',
      subject,
      detail: recoveryDetail(state, recoveryNow),
      recovery: getRecoveryPresentation(state, recoveryNow) ?? undefined,
      tone: 'warning',
    };
  }

  if (runtimeMode === 'paused') {
    return {
      mode: 'paused',
      progressState: 'paused',
      label: 'Paused',
      badge: 'PAUSED',
      subject,
      detail: currentAutomatableDrop
        ? `Progress paused at ${trackedProgress(currentAutomatableDrop)}%.`
        : 'Farming is paused.',
      tone: 'warning',
    };
  }

  if (runtimeMode === 'running') {
    if (
      state.selectedGame &&
      state.queueEntryMetadataByKey[gameKey(state.selectedGame)]?.streamerRetryReason
    ) {
      return {
        mode: 'recovering',
        progressState: 'recovering',
        label: 'Attempt in progress',
        badge: 'RETRYING',
        subject,
        detail: 'Checking playback and waiting for Twitch progress.',
        tone: 'warning',
      };
    }
    if (currentAutomatableDrop) {
      const eta = formatEtaMinutes(currentAutomatableDrop.remainingMinutes);
      return {
        mode: 'running',
        progressState: 'tracking',
        label: 'Running',
        badge: 'RUNNING',
        subject,
        detail: `${trackedProgress(currentAutomatableDrop)}%${eta ? ` · ETA ${eta}` : ''}`,
        tone: 'success',
      };
    }
    return {
      mode: 'running',
      progressState: 'waiting',
      label: 'Running',
      badge: 'RUNNING',
      subject,
      detail: state.activeStreamer
        ? `Watching ${state.activeStreamer.displayName}; waiting for Twitch progress.`
        : 'Finding an eligible streamer.',
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
        badge: 'STOPPED',
        subject,
        detail: '',
        tone: 'neutral',
      };
    }
    if (
      state.lastStopReason === 'sign-in-required' ||
      state.lastStopReason === 'stall-skipped' ||
      state.lastStopReason === 'queue-retries-exhausted' ||
      state.lastStopReason === 'no-active-campaigns'
    ) {
      return {
        mode: 'attention-required',
        progressState: 'unavailable',
        label: 'Attention required',
        badge: 'ATTENTION',
        subject,
        detail: stopReason,
        tone: 'danger',
      };
    }
    return {
      mode: 'complete',
      progressState: 'complete',
      label: 'Complete',
      badge: 'COMPLETE',
      subject,
      detail: stopReason,
      tone: 'success',
    };
  }

  const startupPresentation = classifyStartupPresentation({
    blocksStartup: Boolean(automaticStartPending),
    automaticStartPending: Boolean(automaticStartPending),
    campaignSyncState: state.campaignSyncState,
  });
  if (startupPresentation === 'starting-silently') {
    return {
      mode: 'pending-validation',
      progressState: 'waiting',
      label: 'Starting',
      badge: 'STARTING',
      subject,
      detail: state.manualQueueAuthorized
        ? 'Refreshing Twitch data before resuming the queue.'
        : 'Refreshing Twitch data before starting a favorite campaign.',
      tone: 'neutral',
    };
  }

  if (
    !state.twitchSessionDetected ||
    campaignSyncStatus === 'syncing' ||
    campaignSyncStatus === 'needs-session' ||
    campaignSyncStatus === 'retry-scheduled' ||
    campaignSyncStatus === 'retry-failed'
  ) {
    return {
      mode: 'pending-validation',
      progressState: 'waiting',
      label: 'Campaigns pending validation',
      badge: 'SYNCING',
      subject,
      detail: 'Confirming saved campaigns with Twitch.',
      tone: 'warning',
    };
  }

  return {
    mode: 'ready',
    progressState: 'waiting',
    label: 'Ready',
    badge: 'IDLE',
    subject,
    detail: state.selectedGame ? '' : 'Choose a campaign below.',
    tone: 'neutral',
  };
}
