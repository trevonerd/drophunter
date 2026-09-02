import { logDebug, logInfo, logWarn } from './logging.ts';
import { applyRecoveryState, clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  MAX_PERSISTENT_RECOVERY_CYCLES,
  MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
  OFFLINE_CONFIRMATION_CHECKS,
  STALLED_PROGRESS_RETRY_MS,
} from './stream-rotation.ts';
import {
  type RotateStreamerIfInvalidOptions,
  rotateStreamerOptsFrom,
  type StreamContext,
} from './streamer-acquisition-contracts.ts';

export async function handleOfflineStream(
  state: ServiceWorkerState,
  context: StreamContext,
  opts: RotateStreamerIfInvalidOptions | undefined,
  now: number,
): Promise<void> {
  state.offlineChecks += 1;
  if (state.offlineChecks < OFFLINE_CONFIRMATION_CHECKS) {
    logDebug('Offline reading not yet confirmed; keeping current streamer', {
      offlineChecks: state.offlineChecks,
      required: OFFLINE_CONFIRMATION_CHECKS,
      channel: state.appState.activeStreamer?.name ?? context.channelName,
    });
    return;
  }
  if (state.appState.recoveryReason === 'stalled-progress') clearRecoveryState(state);
  if (
    state.recoveryBackoffUntil > 0 &&
    now < state.recoveryBackoffUntil &&
    (state.appState.recoveryReason === 'offline' ||
      state.appState.recoveryReason === 'open-failed' ||
      state.appState.recoveryReason === 'no-streamers')
  ) {
    logDebug('Offline detected but in recovery backoff, skipping rotation', {
      recoveryReason: state.appState.recoveryReason,
      backoffRemainingMs: state.recoveryBackoffUntil - now,
    });
    return;
  }
  if (state.stalledRecoveryAttempts > MAX_PERSISTENT_RECOVERY_CYCLES) {
    logWarn('Offline recovery exhausted — skipping game', {
      stalledRecoveryAttempts: state.stalledRecoveryAttempts,
      channel: state.appState.activeStreamer?.name ?? context.channelName,
    });
    await opts?.onSkipCurrentGame?.();
    return;
  }
  state.invalidStreamChecks = 0;
  logInfo('Offline stream detected, rotating immediately', {
    channel: state.appState.activeStreamer?.name ?? context.channelName,
    pageUrl: context.pageUrl,
  });
  await opts?.onRotateStreamer?.(state, 'offline', rotateStreamerOptsFrom(opts));
}

export async function handleStalledProgress(
  state: ServiceWorkerState,
  tab: { id?: number },
  opts: RotateStreamerIfInvalidOptions | undefined,
  now: number,
  stallThreshold: number,
): Promise<void> {
  if (state.stalledRecoveryAttempts >= MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS) {
    logWarn('Stalled progress recovery exhausted — skipping game', {
      stalledRecoveryAttempts: state.stalledRecoveryAttempts,
      maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
    });
    await opts?.onSkipCurrentGame?.();
    return;
  }
  if (
    state.recoveryBackoffUntil > 0 &&
    now < state.recoveryBackoffUntil &&
    state.appState.recoveryReason === 'stalled-progress'
  )
    return;
  if (state.stalledRecoveryAttempts === 0) {
    state.stalledRecoveryAttempts = 1;
    state.lastRecoveryAttemptAt = now;
    state.recoveryBackoffUntil = now + STALLED_PROGRESS_RETRY_MS;
    applyRecoveryState(state, 'stalled-progress', state.recoveryBackoffUntil);
    logInfo('Attempting in-place playback self-heal before rotating', {
      stalledRecoveryAttempts: state.stalledRecoveryAttempts,
      maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
      recoveryBackoffUntil: state.recoveryBackoffUntil,
    });
    if (opts?.onAttemptPlaybackSelfHeal && tab.id) await opts.onAttemptPlaybackSelfHeal(tab.id);
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return;
  }
  if (opts?.onForceRefreshDropsData) {
    const refreshOutcome = await opts.onForceRefreshDropsData();
    if (refreshOutcome === 'auth-required') return;
    if (state.stalledRecoveryAttempts === 0 || state.appState.currentDrop == null) return;
  }
  state.stalledRecoveryAttempts = Math.min(
    MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
    state.stalledRecoveryAttempts + 1,
  );
  state.lastRecoveryAttemptAt = now;
  state.recoveryBackoffUntil = 0;
  state.invalidStreamChecks = 0;
  applyRecoveryState(state, 'stalled-progress', null);
  logInfo('Drop progress stalled, rotating to a different streamer', {
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
    maxAttempts: MAX_STALLED_PROGRESS_RECOVERY_ATTEMPTS,
    progress: state.appState.currentDrop?.progress ?? null,
    currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
    requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
    effectiveThresholdMs: stallThreshold,
    stalledForMs: now - state.lastProgressAdvanceAt,
  });
  await opts?.onRotateStreamer?.(state, 'stalled-progress', rotateStreamerOptsFrom(opts));
}
