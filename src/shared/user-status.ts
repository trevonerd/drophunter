import type { AppState, TwitchDrop } from '../types';
import { getGameDisplayLabel } from './game-selection';
import {
  formatEtaMinutes,
  formatRecoveryReason,
  formatRetryLabel,
  formatStopReason,
  type RuntimeMode,
} from './runtime-status';

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

function campaignSubject(state: AppState): string {
  return state.selectedGame ? getGameDisplayLabel(state.selectedGame) : 'No campaign selected';
}

function recoveryDetail(state: AppState, now: number): string {
  const reason = formatRecoveryReason(state.recoveryReason) ?? 'Restoring farming';
  const retry = formatRetryLabel(state.recoveryBackoffUntil, now);
  return retry ? `${reason} · ${retry}` : reason;
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
  const subject = campaignSubject(state);
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

  if (runtimeMode === 'recovering') {
    return {
      mode: 'recovering',
      progressState: 'recovering',
      label: 'Recovering',
      badge: 'RECOVERING',
      subject,
      detail: recoveryDetail(state, recoveryNow),
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

  if (
    automaticStartPending ||
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
      detail: automaticStartPending
        ? state.manualQueueAuthorized
          ? 'The started queue will resume after validation.'
          : 'Favorite auto-start will run after validation.'
        : 'Confirming saved campaigns with Twitch.',
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
