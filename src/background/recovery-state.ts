// ============================================================================
// recovery-state.ts — Recovery & stop-state mutators for ServiceWorkerState.
//
// Owns the SME for resetting/applying recovery-backoff state (stalled-recovery
// counter, retry deadline, last-attempt timestamp, recovery notification flag)
// and terminal stop-state transitions. Stops are terminal when farming ends
// (manual stop, queue complete, no active campaigns, sign-in required);
// recovery is self-heal/backoff/rotation before any terminal stop.
//
// Caller (service-worker wrappers / farming-session / queue-management) owns
// the policy that decides WHEN to invoke these — recover vs skip vs stop —
// and persists/broadcasts state after these mutators run.
//
// DAG-leaf invariant: this module imports only from shared/* and
// background/stream-rotation (itself a downstream leaf). MUST NOT import from
// queue-management, drops-projection, state-persistence, or claim-log, or it
// would close a circular edge with the rest of the background layer.
// ============================================================================

import {
  applyRecoveryStatus,
  applyTerminalStopStatus,
  clearRecoveryStatus,
  clearTerminalStopStatus,
} from '../shared/runtime-status';
import { logWarn } from './logging';
import type { ServiceWorkerState } from './service-worker';
import {
  computeRecoveryBackoffMs,
  MAX_PERSISTENT_RECOVERY_CYCLES,
  StreamRotationReason,
} from './stream-rotation';

export function clearRecoveryState(state: ServiceWorkerState) {
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;
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

export function clearNoStreamersRecoveryState(state: ServiceWorkerState) {
  if (state.appState.recoveryReason !== 'no-streamers') {
    return;
  }
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.appState = clearRecoveryStatus(state.appState);
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

export function applyStopState(state: ServiceWorkerState, reason: string, message: string | null) {
  clearRecoveryState(state);
  state.appState = applyTerminalStopStatus(state.appState, { reason, message });
}

export async function enterPersistentRecovery(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  message: string,
  opts?: {
    onSkipCurrentGame?: () => Promise<void>;
    onNotify?: (title: string, message: string, priority?: number) => Promise<void>;
  },
) {
  state.stalledRecoveryAttempts += 1;

  if (state.stalledRecoveryAttempts > MAX_PERSISTENT_RECOVERY_CYCLES) {
    if (opts?.onSkipCurrentGame) {
      await opts.onSkipCurrentGame();
    }
    return;
  }

  const backoffMs = computeRecoveryBackoffMs(state.stalledRecoveryAttempts);
  state.recoveryBackoffUntil = Date.now() + backoffMs;
  state.lastRecoveryAttemptAt = Date.now();
  applyRecoveryState(state, reason, state.recoveryBackoffUntil);
  logWarn('Entering persistent recovery mode', {
    reason,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
    backoffMs,
    retryAt: state.recoveryBackoffUntil,
  });
  if (!state.recoveryNotificationSent) {
    state.recoveryNotificationSent = true;
    await opts?.onNotify?.('DropHunter is still recovering', message, 1);
  }
}
