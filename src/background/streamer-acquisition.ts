import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isStreamerAcquisitionRecovery } from '../shared/runtime-status.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
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
  const acquisitionRecoveryActive = isStreamerAcquisitionRecovery(state.appState.recoveryReason);
  const previousAttempts = acquisitionRecoveryActive ? Math.max(0, state.appState.recoveryAttempts ?? 0) : 0;
  if (acquisitionRecoveryActive && state.recoveryBackoffUntil > now) return false;
  let opened = false;
  let failureKind: 'no-streamers' | 'directory-unavailable' = 'no-streamers';
  try {
    opened = opts?.onOpenStreamer ? await opts.onOpenStreamer() : false;
  } catch (error) {
    if (!(error instanceof TwitchDirectoryUnavailableError)) throw error;
    if (opts?.isCurrent?.() === false) return false;
    failureKind = 'directory-unavailable';
  }
  if (opts?.isCurrent?.() === false) return false;
  if (opened) {
    clearStreamerAcquisitionRecoveryState(state);
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return true;
  }
  if (previousAttempts >= MAX_NO_STREAMERS_RETRIES) {
    await opts?.onSkipCurrentGame?.();
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return false;
  }
  const attempts = previousAttempts + 1;
  const retryAt =
    failureKind === 'directory-unavailable'
      ? Math.max(state.apiBackoffUntil, now + NO_STREAMERS_RETRY_MS)
      : now + NO_STREAMERS_RETRY_MS;
  switch (failureKind) {
    case 'directory-unavailable':
      applyDirectoryUnavailableRecoveryState(state, retryAt, attempts);
      logWarn('Twitch streamer search unavailable; scheduling retry', {
        game: getGameDisplayLabel(state.appState.selectedGame),
        retryAt,
        attempts,
      });
      break;
    case 'no-streamers':
      applyNoStreamersRecoveryState(state, retryAt, attempts);
      logWarn('No eligible streamer found for current Drops; scheduling one retry', {
        game: getGameDisplayLabel(state.appState.selectedGame),
        retryAt,
        attempts,
      });
      break;
  }
  await opts?.onSaveState?.();
  await opts?.onSaveTimingState?.(state);
  return false;
}

export async function rotateStreamer(
  state: ServiceWorkerState,
  reason: StreamRotationReason,
  opts?: RotateStreamerOptions,
): Promise<boolean> {
  const epoch = currentFarmingSessionEpoch(state);
  const generation = state.tickGeneration;
  const campaignKey = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
  const isCurrent = () =>
    opts?.isCurrent?.() !== false &&
    currentFarmingSessionEpoch(state) === epoch &&
    state.tickGeneration === generation &&
    (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null) === campaignKey;
  if (!isCurrent()) return false;
  state.noProgressRotationAttempts = nextNoProgressRotationAttempts(state.noProgressRotationAttempts, reason);
  const now = Date.now();
  state.appState.lastRotationReason = reason;
  state.appState.lastRotationAt = now;
  state.lastStreamRotationAt = now;
  state.lastProgressAdvanceAt = now;
  state.offlineChecks = 0;
  if (state.appState.activeStreamer?.name) state.avoidStreamerName = state.appState.activeStreamer.name;
  state.appState.activeStreamer = null;
  let opened = false;
  try {
    opened = opts?.onOpenStreamer ? await opts.onOpenStreamer(isCurrent) : false;
  } catch (error) {
    if (!isCurrent()) return false;
    throw error;
  }
  if (!isCurrent()) return false;
  if (!opened && reason === 'stalled-progress') await opts?.onSkipCurrentGame?.();
  if (!isCurrent()) return false;
  await opts?.onSaveState?.();
  if (!isCurrent()) return false;
  await opts?.onSaveTimingState?.(state);
  return opened;
}
