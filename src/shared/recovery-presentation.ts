import type { AppState } from '../types/index.ts';

export type RecoveryOperation =
  | 'find-streamer'
  | 'start-playback'
  | 'verify-session'
  | 'verify-integrity'
  | 'refresh-twitch-data'
  | 'check-progress';

export interface RecoveryPresentation {
  readonly phase: 'scheduled' | 'due' | 'extended' | 'unscheduled';
  readonly operation: RecoveryOperation;
  readonly reason: string;
  readonly nextRetryAt: number | null;
  readonly action: 'retry' | 'wait';
}

function recoveryOperation(reason: string): RecoveryOperation {
  if (reason === 'open-failed') return 'start-playback';
  if (reason === 'no-streamers' || reason === 'directory-unavailable') return 'find-streamer';
  if (reason === 'twitch-auth') return 'verify-session';
  if (reason === 'twitch-integrity') return 'verify-integrity';
  if (reason.startsWith('twitch-')) return 'refresh-twitch-data';
  return 'check-progress';
}

export function getRecoveryPresentation(
  state: Pick<AppState, 'isRunning' | 'isPaused' | 'recoveryReason' | 'recoveryBackoffUntil'>,
  now = Date.now(),
): RecoveryPresentation | null {
  const reason = state.recoveryReason;
  if (!reason) return null;
  const deadline = state.recoveryBackoffUntil;
  const nextRetryAt =
    typeof deadline === 'number' && Number.isFinite(deadline) && deadline >= 0 ? deadline : null;
  const phase =
    nextRetryAt === null
      ? 'unscheduled'
      : nextRetryAt <= now
        ? 'due'
        : nextRetryAt - now > 5 * 60_000
          ? 'extended'
          : 'scheduled';
  return {
    phase,
    operation: recoveryOperation(reason),
    reason,
    nextRetryAt,
    action:
      state.isRunning &&
      !state.isPaused &&
      !(reason === 'twitch-rate-limit' && nextRetryAt !== null && nextRetryAt > now)
        ? 'retry'
        : 'wait',
  };
}
