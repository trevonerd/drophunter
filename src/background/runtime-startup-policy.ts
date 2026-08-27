import type { AppState } from '../types/index.ts';

export type StartupResumePolicyResult = 'not-stale' | 'auto-resume' | 'paused-on-startup' | 'resume-recovery';

const ACTIVE_NO_TAB_RECOVERY_REASONS = new Set(['no-streamers', 'offline', 'open-failed']);

export interface StartupResumePolicyState {
  appState: AppState;
  lastHeartbeatAt: number;
  recoveryBackoffUntil: number;
  lastRecoveryAttemptAt: number;
  stalledRecoveryAttempts: number;
  recoveryNotificationSent: boolean;
}

export function applyStartupResumePolicy(
  state: StartupResumePolicyState,
  now: number,
  staleThresholdMs: number,
  resumeRecoveryGraceMs: number,
): StartupResumePolicyResult {
  const shouldApply =
    state.appState.isRunning &&
    !state.appState.isPaused &&
    state.lastHeartbeatAt > 0 &&
    now - state.lastHeartbeatAt > staleThresholdMs;
  if (!shouldApply) return 'not-stale';

  const heartbeatGap = now - state.lastHeartbeatAt;
  const recoveryReason = state.appState.recoveryReason;
  const hasActiveNoTabRecovery =
    typeof recoveryReason === 'string' &&
    (ACTIVE_NO_TAB_RECOVERY_REASONS.has(recoveryReason) ||
      (recoveryReason === 'stalled-progress' &&
        state.appState.tabId === null &&
        state.appState.watchTransportMode === 'tabless'));
  if (hasActiveNoTabRecovery && heartbeatGap < resumeRecoveryGraceMs) return 'resume-recovery';
  if (state.appState.autoResumeOnStartup) return 'auto-resume';

  state.appState = {
    ...state.appState,
    isPaused: true,
    tabId: null,
    activeStreamer: null,
    recoveryReason: null,
    recoveryBackoffUntil: null,
    recoveryAttempts: null,
    resumedFromCrash: null,
  };
  state.recoveryBackoffUntil = 0;
  state.lastRecoveryAttemptAt = 0;
  state.stalledRecoveryAttempts = 0;
  state.recoveryNotificationSent = false;
  return 'paused-on-startup';
}
