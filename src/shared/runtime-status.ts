import type { AppState, CampaignRemainderReason } from '../types/index.ts';

export type RuntimeMode = 'idle' | 'running' | 'paused' | 'recovering' | 'stopped-terminal';

export interface RecoveryState {
  reason: string;
  retryAt: number | null;
  attempts: number | null;
}

export interface TerminalStopState {
  reason: string;
  message: string | null;
}

export const MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS = 3;

function assertNever(value: never): never {
  throw new TypeError(`Unhandled campaign remainder reason: ${String(value)}`);
}

export function deriveRuntimeMode(
  state: Pick<AppState, 'isRunning' | 'isPaused' | 'recoveryReason' | 'lastStopReason'>,
) {
  if (state.isRunning) {
    if (state.isPaused) {
      return 'paused' as const;
    }
    if (state.recoveryReason) {
      return 'recovering' as const;
    }
    return 'running' as const;
  }
  if (state.lastStopReason) {
    return 'stopped-terminal' as const;
  }
  return 'idle' as const;
}

export function getRecoveryState(
  state: Pick<AppState, 'recoveryReason' | 'recoveryBackoffUntil' | 'recoveryAttempts'>,
) {
  if (!state.recoveryReason) {
    return null;
  }
  return {
    reason: state.recoveryReason,
    retryAt: state.recoveryBackoffUntil ?? null,
    attempts: state.recoveryAttempts ?? null,
  } satisfies RecoveryState;
}

export function getTerminalStopState(state: Pick<AppState, 'lastStopReason' | 'lastStopMessage'>) {
  if (!state.lastStopReason) {
    return null;
  }
  return {
    reason: state.lastStopReason,
    message: state.lastStopMessage ?? null,
  } satisfies TerminalStopState;
}

export function clearRecoveryStatus(state: AppState): AppState {
  return {
    ...state,
    recoveryReason: null,
    recoveryBackoffUntil: null,
    recoveryAttempts: null,
  };
}

export function clearTerminalStopStatus(state: AppState): AppState {
  return {
    ...state,
    lastStopReason: null,
    lastStopMessage: null,
  };
}

export function applyRecoveryStatus(state: AppState, recovery: RecoveryState): AppState {
  return clearTerminalStopStatus({
    ...state,
    recoveryReason: recovery.reason,
    recoveryBackoffUntil: recovery.retryAt,
    recoveryAttempts: recovery.attempts,
  });
}

export function applyTerminalStopStatus(state: AppState, stop: TerminalStopState): AppState {
  return clearRecoveryStatus({
    ...state,
    lastStopReason: stop.reason,
    lastStopMessage: stop.message,
  });
}

export function formatStopReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'no-active-campaigns':
      return 'No active Twitch Drops campaigns found';
    case 'queue-complete':
      return 'Queue complete';
    case 'farming-complete':
      return 'Farming finished';
    case 'sign-in-required':
      return 'Twitch sign-in required';
    case 'stall-skipped':
      return 'Stopped after repeated stalls';
    case 'unverifiable-twitch':
      return 'Farming finished · Twitch reward acquisition could not be verified';
    case 'user-stop':
      return 'Stopped';
    default:
      return reason ?? null;
  }
}

export function formatFarmingCompleteStatusLines(
  reasons: readonly CampaignRemainderReason[],
): readonly string[] {
  return (['subscription-required', 'unverifiable-twitch'] as const)
    .filter((reason) => reasons.includes(reason))
    .map(formatFarmingCompleteStatusLine);
}

export function formatFarmingCompleteStatusLine(reason: CampaignRemainderReason): string {
  switch (reason) {
    case 'subscription-required':
      return 'All farmable rewards claimed · Subscription required for remaining rewards';
    case 'unverifiable-twitch':
      return 'Farming finished · Twitch reward acquisition could not be verified';
    default:
      return assertNever(reason);
  }
}

export function formatRotationReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'offline':
      return 'Stream went offline';
    case 'wrong-channel':
      return 'Wrong channel detected';
    case 'wrong-game':
      return 'Wrong game detected';
    case 'drops-inactive':
      return 'Drops signal missing';
    case 'stalled-progress':
      return 'Progress stalled';
    case 'missing-context':
      return 'Stream unresponsive';
    case 'navigated-away':
      return 'Tab navigated away';
    case 'open-failed':
      return 'Could not open stream';
    case 'no-streamers':
      return 'No live streamers found';
    default:
      return reason ?? null;
  }
}

export function formatRecoveryReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'stalled-progress':
      return 'Checking stalled drop progress';
    case 'open-failed':
      return 'Could not open stream';
    case 'no-streamers':
      return 'No live streamers found';
    case 'drops-inactive':
      return 'Recovering missing drops signal';
    case 'wrong-game':
      return 'Recovering wrong game';
    case 'wrong-channel':
      return 'Recovering wrong channel';
    case 'offline':
      return 'Recovering offline stream';
    default:
      return reason ?? null;
  }
}

export function formatRecoveryAttemptLabel(
  reason: string | null | undefined,
  attempts: number | null | undefined,
): string | null {
  if (reason !== 'stalled-progress' || typeof attempts !== 'number' || !Number.isFinite(attempts)) {
    return null;
  }
  const safeAttempts = Math.max(1, Math.min(MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS, Math.floor(attempts)));
  return `attempt ${safeAttempts}/${MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS}`;
}

export function formatRetryLabel(timestamp?: number | null, now = Date.now()): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= now) {
    return null;
  }
  const seconds = Math.max(1, Math.ceil((timestamp - now) / 1000));
  if (seconds < 60) {
    return `retry in ${seconds}s`;
  }
  return `retry in ${Math.ceil(seconds / 60)}m`;
}
