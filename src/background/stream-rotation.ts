export const MAX_NO_PROGRESS_ROTATION_ATTEMPTS = 3;

export type StreamRotationReason =
  | 'missing-context'
  | 'navigated-away'
  | 'offline'
  | 'wrong-channel'
  | 'stalled-progress'
  | 'open-failed';

export function shouldIncrementNoProgressRotationAttempts(reason: StreamRotationReason): boolean {
  return reason === 'stalled-progress' || reason === 'open-failed';
}

export function nextNoProgressRotationAttempts(
  previousAttempts: number,
  reason: StreamRotationReason,
): number {
  if (!shouldIncrementNoProgressRotationAttempts(reason)) {
    return previousAttempts;
  }
  return Math.min(MAX_NO_PROGRESS_ROTATION_ATTEMPTS, previousAttempts + 1);
}

export function didDropProgressAdvance(previousProgress: number, currentProgress: number): boolean {
  return currentProgress > previousProgress;
}
