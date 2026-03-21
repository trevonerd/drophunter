import type { AppState } from '../types/index.ts';

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
      return 'No eligible stream found';
    default:
      return reason ?? null;
  }
}

export function formatRecoveryReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'stalled-progress':
      return 'Recovering stalled progress';
    case 'open-failed':
      return 'Retrying stream recovery';
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
