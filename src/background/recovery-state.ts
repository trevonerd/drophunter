// ============================================================================
// recovery-state.ts — Recovery & stop-state mutators for ServiceWorkerState.
//
// Owns the SME for resetting/applying recovery-backoff state (stalled-recovery
// counter, retry deadline and last-attempt timestamp)
// and terminal stop-state transitions. Stops are terminal when farming ends
// (manual stop, all authorized targets acquired or expired);
// recovery is self-heal/backoff/rotation before any terminal stop.
//
// Callers (service-worker wrappers / farming-session) own
// the policy that decides WHEN to invoke these — recover vs skip vs stop —
// and persists/broadcasts state after these mutators run.
//
// DAG-leaf invariant: this module imports only from shared/* and
// background/stream-rotation (itself a downstream leaf). MUST NOT import from
// drops-projection, state-persistence, or claim-log, or it
// would close a circular edge with the rest of the background layer.
// ============================================================================

import {
  applyRecoveryStatus,
  applyTerminalStopStatus,
  clearRecoveryStatus,
  clearTerminalStopStatus,
  isStreamerAcquisitionRecovery,
} from '../shared/runtime-status';
import type { ServiceWorkerState } from './runtime-state.ts';
import { NO_STREAMERS_RETRY_MS, StreamRotationReason } from './stream-rotation';
import type { TwitchApiFailureKind } from './twitch-api/errors.ts';
import { markTwitchSessionRetrying } from './twitch-session-sync.ts';

export function clearRecoveryState(state: ServiceWorkerState) {
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.appState = clearRecoveryStatus(state.appState);
}

export function clearStopState(state: ServiceWorkerState) {
  state.appState = clearTerminalStopStatus(state.appState);
}

export function applyRecoveryState(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  retryAt: number | null,
) {
  state.appState = applyRecoveryStatus(state.appState, {
    reason,
    retryAt,
    attempts: state.stalledRecoveryAttempts,
  });
}

export function clearStreamerAcquisitionRecoveryState(state: ServiceWorkerState) {
  if (!isStreamerAcquisitionRecovery(state.appState.recoveryReason)) {
    return;
  }
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.appState = clearRecoveryStatus(state.appState);
}

export function applyTwitchDataUnavailableRecoveryState(state: ServiceWorkerState) {
  state.recoveryBackoffUntil = Math.max(state.apiBackoffUntil, Date.now() + NO_STREAMERS_RETRY_MS);
  state.lastRecoveryAttemptAt = Date.now();
  state.appState = applyRecoveryStatus(state.appState, {
    reason: 'twitch-data-unavailable',
    retryAt: state.recoveryBackoffUntil,
    attempts: Math.max(1, state.apiConsecutiveFailures),
  });
}

export function applyApiBackoffRecoveryState(state: ServiceWorkerState) {
  if (!state.appState.recoveryReason?.startsWith('twitch-')) {
    applyTwitchDataUnavailableRecoveryState(state);
    return;
  }
  const retryAt = Math.max(state.recoveryBackoffUntil, state.apiBackoffUntil);
  state.recoveryBackoffUntil = retryAt;
  state.appState.recoveryBackoffUntil = retryAt;
}

export function applyGlobalStreamerRecoveryState(state: ServiceWorkerState, kind: TwitchApiFailureKind) {
  state.recoveryBackoffUntil = state.apiBackoffUntil;
  state.lastRecoveryAttemptAt = Date.now();
  state.appState = applyRecoveryStatus(state.appState, {
    reason: `twitch-${kind}`,
    retryAt: state.apiBackoffUntil,
    attempts: state.apiConsecutiveFailures,
  });
}

export function applyDirectoryUnavailableRecoveryState(
  state: ServiceWorkerState,
  retryAt: number,
  attempts: number,
) {
  state.recoveryBackoffUntil = retryAt;
  state.lastRecoveryAttemptAt = Date.now();
  state.appState = applyRecoveryStatus(state.appState, {
    reason: 'directory-unavailable',
    retryAt,
    attempts,
  });
}

export function applyNoStreamersRecoveryState(state: ServiceWorkerState, retryAt: number, attempts: number) {
  state.recoveryBackoffUntil = retryAt;
  state.lastRecoveryAttemptAt = Date.now();
  state.appState = applyRecoveryStatus(state.appState, {
    reason: 'no-streamers',
    retryAt,
    attempts,
  });
}

export function applyPlaybackStartRecoveryState(
  state: ServiceWorkerState,
  retryAt: number,
  attempts: number,
) {
  state.recoveryBackoffUntil = retryAt;
  state.lastRecoveryAttemptAt = Date.now();
  state.appState = applyRecoveryStatus(state.appState, {
    reason: 'open-failed',
    retryAt,
    attempts,
  });
}

export function applyTwitchSessionRetryState(state: ServiceWorkerState, retryAt: number, attempts: number) {
  markTwitchSessionRetrying(state, retryAt, attempts);
}

export function applyStopState(state: ServiceWorkerState, reason: string, message: string | null) {
  clearRecoveryState(state);
  state.appState = applyTerminalStopStatus(state.appState, { reason, message });
}
