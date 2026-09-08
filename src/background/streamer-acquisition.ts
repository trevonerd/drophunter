import { getGameDisplayLabel } from '../shared/game-selection.ts';
import { logWarn } from './logging.ts';
import {
  applyDirectoryUnavailableRecoveryState,
  applyNoStreamersRecoveryState,
  clearStreamerAcquisitionRecoveryState,
} from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  MAX_NO_STREAMERS_RETRIES,
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  type StreamRotationReason,
} from './stream-rotation.ts';
import type { RotateStreamerOptions } from './streamer-acquisition-contracts.ts';
import { TwitchDirectoryUnavailableError } from './twitch-api/errors.ts';

export type {
  OpenBestStreamerCallbacks,
  RotateStreamerIfInvalidOptions,
  RotateStreamerOptions,
} from './streamer-acquisition-contracts.ts';
export { openBestStreamerForSelectedGame } from './streamer-selection-flow.ts';
export { rotateStreamerIfInvalid } from './streamer-validation.ts';

export async function acquireStreamerForSelectedGame(
  state: ServiceWorkerState,
  opts?: {
    onOpenStreamer?: () => Promise<boolean>;
    onSkipCurrentGame?: () => Promise<void>;
    onSaveState?: () => Promise<void>;
    onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
    isCurrent?: () => boolean;
  },
): Promise<boolean> {
  if (opts?.isCurrent?.() === false) return false;
  if (!state.appState.selectedGame) return false;
  const now = Date.now();
  const isNoStreamersRecovery = state.appState.recoveryReason === 'no-streamers';
  const isStreamerAcquisitionRecovery =
    isNoStreamersRecovery || state.appState.recoveryReason === 'directory-unavailable';
  if (isStreamerAcquisitionRecovery && state.recoveryBackoffUntil > now) return false;
  let opened = false;
  try {
    opened = opts?.onOpenStreamer ? await opts.onOpenStreamer() : false;
  } catch (error) {
    if (!(error instanceof TwitchDirectoryUnavailableError)) throw error;
    const retryAt = Math.max(state.apiBackoffUntil, now + NO_STREAMERS_RETRY_MS);
    applyDirectoryUnavailableRecoveryState(state, retryAt, Math.max(1, state.apiConsecutiveFailures));
    logWarn('Twitch streamer search unavailable; scheduling retry', {
      game: getGameDisplayLabel(state.appState.selectedGame),
      retryAt,
    });
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return false;
  }
  if (opts?.isCurrent?.() === false) return false;
  if (opened) {
    clearStreamerAcquisitionRecoveryState(state);
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return true;
  }
  const previousAttempts = isNoStreamersRecovery ? Math.max(0, state.appState.recoveryAttempts ?? 0) : 0;
  if (previousAttempts >= MAX_NO_STREAMERS_RETRIES) {
    await opts?.onSkipCurrentGame?.();
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return false;
  }
  const retryAt = now + NO_STREAMERS_RETRY_MS;
  applyNoStreamersRecoveryState(state, retryAt, previousAttempts + 1);
  logWarn('No eligible streamer found for current Drops; scheduling one retry', {
    game: getGameDisplayLabel(state.appState.selectedGame),
    retryAt,
    attempts: previousAttempts + 1,
  });
  await opts?.onSaveState?.();
  await opts?.onSaveTimingState?.(state);
  return false;
}

export async function rotateStreamer(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  opts?: RotateStreamerOptions,
): Promise<boolean> {
  state.noProgressRotationAttempts = nextNoProgressRotationAttempts(state.noProgressRotationAttempts, reason);
  const now = Date.now();
  state.appState.lastRotationReason = reason;
  state.appState.lastRotationAt = now;
  state.lastStreamRotationAt = now;
  state.lastProgressAdvanceAt = now;
  state.offlineChecks = 0;
  if (state.appState.activeStreamer?.name) state.avoidStreamerName = state.appState.activeStreamer.name;
  state.appState.activeStreamer = null;
  const opened = opts?.onOpenStreamer ? await opts.onOpenStreamer() : false;
  if (!opened && reason === 'stalled-progress') await opts?.onSkipCurrentGame?.();
  await opts?.onSaveState?.();
  await opts?.onSaveTimingState?.(state);
  return opened;
}
