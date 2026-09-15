import { getGameDisplayLabel } from '../../shared/game-selection';
import { formatStopReason, type RuntimeMode } from '../../shared/runtime-status';
import type { AppState, TwitchDrop } from '../../types';
import { formatEtaMinutes, recoveryAttemptLabel, retryLabel, statusReasonLabel } from '../format';

export type SessionSummaryMode =
  | 'ready'
  | 'pending-validation'
  | 'running'
  | 'paused'
  | 'recovering'
  | 'stopped'
  | 'complete'
  | 'attention-required';

export type ProgressState = 'waiting' | 'tracking' | 'paused' | 'recovering' | 'complete' | 'unavailable';

export type SessionSummaryModel = {
  readonly mode: SessionSummaryMode;
  readonly progressState: ProgressState;
  readonly label: string;
  readonly subject: string;
  readonly detail: string;
  readonly tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
};

export type EffectiveTransport = {
  readonly mode: 'hidden' | 'tab' | 'manual-tab';
  readonly label: 'Hidden' | 'Tab' | 'Manual tab';
  readonly icon: 'eye-off' | 'monitor';
};

export type SessionSummaryModelInput = {
  readonly state: AppState;
  readonly runtimeMode: RuntimeMode;
  readonly currentAutomatableDrop: TwitchDrop | null;
  readonly recoveryNow: number;
  readonly automaticStartPending?: boolean;
};

function campaignSubject(state: AppState): string {
  return state.selectedGame ? getGameDisplayLabel(state.selectedGame) : 'No campaign selected';
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

export function createSessionSummaryModel({
  state,
  runtimeMode,
  currentAutomatableDrop,
  recoveryNow,
  automaticStartPending,
}: SessionSummaryModelInput): SessionSummaryModel {
  const subject = campaignSubject(state);
  const manualWatchState = state.manualWatchState ?? 'inactive';
  const campaignSyncStatus = state.campaignSyncState?.status;

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
      detail:
        state.recoveryReason === 'no-streamers'
          ? `${recoveryParts.join(' · ') || 'No eligible streamer found yet'}. DropHunter will search again automatically.`
          : `${recoveryParts.join(' · ') || 'Restoring the farming session'}. Farming is paused while DropHunter retries automatically.`,
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
        subject,
        detail: stopReason,
        tone: 'danger',
      };
    }
    return {
      mode: 'complete',
      progressState: 'complete',
      label: 'Complete',
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
      subject,
      detail: automaticStartPending
        ? state.manualQueueAuthorized
          ? 'The started queue will resume automatically after campaign validation succeeds.'
          : 'Favorite auto-start will check eligible favorites after campaign validation succeeds.'
        : 'Saved campaign data will be confirmed when Twitch is available.',
      tone: 'warning',
    };
  }

  return {
    mode: 'ready',
    progressState: 'waiting',
    label: 'Ready',
    subject,
    detail: state.selectedGame ? '' : 'Choose a campaign below.',
    tone: 'neutral',
  };
}
