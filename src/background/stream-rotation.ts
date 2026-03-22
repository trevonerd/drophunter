export const MAX_NO_PROGRESS_ROTATION_ATTEMPTS = 3;
export const RECOVERY_BACKOFF_BASE_MS = 60_000;
export const MAX_RECOVERY_BACKOFF_MS = 15 * 60_000;

export type StreamRotationReason =
  | 'missing-context'
  | 'navigated-away'
  | 'offline'
  | 'wrong-channel'
  | 'wrong-game'
  | 'drops-inactive'
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

export function computeRecoveryBackoffMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(RECOVERY_BACKOFF_BASE_MS * 2 ** (safeAttempts - 1), MAX_RECOVERY_BACKOFF_MS);
}

export interface StreamHealthInput {
  isLive: boolean;
  sameChannel: boolean;
  sameGame: boolean;
  hasDropsSignal: boolean;
  progressStalled: boolean;
  expectsDropsSignal: boolean;
}

export interface StreamHealthResult {
  isHealthy: boolean;
  forceImmediateRotation: boolean;
  invalidIncrement: number;
  reason: StreamRotationReason | null;
}

export function classifyStreamHealth(input: StreamHealthInput): StreamHealthResult {
  const healthyLiveStream =
    input.isLive &&
    input.sameChannel &&
    input.sameGame &&
    !input.progressStalled &&
    (!input.expectsDropsSignal || input.hasDropsSignal);

  if (healthyLiveStream) {
    return { isHealthy: true, forceImmediateRotation: false, invalidIncrement: 0, reason: null };
  }

  if (!input.isLive) {
    return { isHealthy: false, forceImmediateRotation: true, invalidIncrement: 0, reason: 'offline' };
  }
  if (!input.sameChannel) {
    return { isHealthy: false, forceImmediateRotation: false, invalidIncrement: 2, reason: 'wrong-channel' };
  }
  if (!input.sameGame) {
    return { isHealthy: false, forceImmediateRotation: false, invalidIncrement: 2, reason: 'wrong-game' };
  }
  if (input.progressStalled) {
    return {
      isHealthy: false,
      forceImmediateRotation: false,
      invalidIncrement: MAX_NO_PROGRESS_ROTATION_ATTEMPTS + 5,
      reason: 'stalled-progress',
    };
  }
  if (input.expectsDropsSignal && !input.hasDropsSignal) {
    return { isHealthy: false, forceImmediateRotation: false, invalidIncrement: 1, reason: 'drops-inactive' };
  }

  return { isHealthy: false, forceImmediateRotation: false, invalidIncrement: 1, reason: 'missing-context' };
}
