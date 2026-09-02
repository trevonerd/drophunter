import { clearRecoveryStatus } from '../shared/runtime-status.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

function clearLegacyAuthRecovery(state: ServiceWorkerState): void {
  if (state.appState.recoveryReason !== 'sign-in-required') return;
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.recoveryNotificationSent = false;
  state.appState = clearRecoveryStatus(state.appState);
}

export function markTwitchSessionRetrying(
  state: ServiceWorkerState,
  retryAt: number,
  attempts: number,
): void {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  state.apiConsecutiveFailures = safeAttempts;
  state.apiBackoffUntil = retryAt;
  clearLegacyAuthRecovery(state);
  state.appState.twitchSessionSyncState = {
    status: 'retrying',
    attempts: safeAttempts,
    nextRetryAt: retryAt,
  };
}

export function markTwitchSessionBlocked(state: ServiceWorkerState, attempts: number): void {
  const safeAttempts = Math.max(0, Math.floor(attempts));
  clearLegacyAuthRecovery(state);
  state.appState.twitchSessionSyncState = {
    status: 'blocked',
    attempts: safeAttempts,
    nextRetryAt: null,
  };
}

export function markTwitchSessionReady(state: ServiceWorkerState): void {
  state.apiConsecutiveFailures = 0;
  state.apiBackoffUntil = 0;
  clearLegacyAuthRecovery(state);
  state.appState.twitchSessionSyncState = {
    status: 'ready',
    attempts: 0,
    nextRetryAt: null,
  };
}
