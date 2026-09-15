import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isStreamerAcquisitionRecovery } from '../shared/runtime-status.ts';
import { applyApiBackoff, getLastTwitchApiFailure } from './api-operations.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { logWarn } from './logging.ts';
import { resetQueueAcquisitionRound } from './queue-acquisition-round.ts';
import {
  applyGlobalStreamerRecoveryState,
  applyNoStreamersRecoveryState,
  clearStreamerAcquisitionRecoveryState,
} from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { prepareQueueAcquisitionRound } from './session-lifecycle-queue-selection.ts';
import {
  MAX_NO_STREAMERS_RETRIES,
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  type StreamRotationReason,
} from './stream-rotation.ts';
import { runStreamerAcquisitionAttempt } from './streamer-acquisition-attempt.ts';
import type { RotateStreamerOptions } from './streamer-acquisition-contracts.ts';
import { classifyTwitchApiFailure, TwitchDirectoryUnavailableError } from './twitch-api/errors.ts';

export type {
  OpenBestStreamerCallbacks,
  RotateStreamerIfInvalidOptions,
  RotateStreamerOptions,
} from './streamer-acquisition-contracts.ts';
export { openBestStreamerForSelectedGame } from './streamer-selection-flow.ts';
export { rotateStreamerIfInvalid } from './streamer-validation.ts';

interface AcquisitionOptions {
  onOpenStreamer?: (isCurrent: () => boolean) => Promise<boolean>;
  onSkipCurrentGame?: (
    reason: 'no-streamers' | 'directory-unavailable',
    isCurrent?: () => boolean,
  ) => Promise<void>;
  onSaveState?: () => Promise<void>;
  onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  isCurrent?: () => boolean;
}

export function acquireStreamerForSelectedGame(
  state: ServiceWorkerState,
  opts: AcquisitionOptions = {},
): Promise<boolean> {
  if (opts.isCurrent?.() === false) return Promise.resolve(false);
  if (state.apiBackoffUntil <= Date.now() && !prepareQueueAcquisitionRound(state))
    return Promise.resolve(false);
  const epoch = currentFarmingSessionEpoch(state);
  const canTransition = () => opts.isCurrent?.() !== false && currentFarmingSessionEpoch(state) === epoch;
  return runStreamerAcquisitionAttempt(
    state,
    (isCurrent, release) => acquireStreamer(state, { ...opts, isCurrent }, release, canTransition),
    opts,
  );
}

async function acquireStreamer(
  state: ServiceWorkerState,
  opts: AcquisitionOptions,
  release: () => void,
  canTransition: () => boolean,
): Promise<boolean> {
  if (opts?.isCurrent?.() === false) return false;
  if (!state.appState.selectedGame) return false;
  const now = Date.now();
  const acquisitionRecoveryActive = isStreamerAcquisitionRecovery(state.appState.recoveryReason);
  const selectedKey = gameKey(state.appState.selectedGame);
  const metadata = state.appState.queueEntryMetadataByKey[selectedKey] ?? {
    source: 'manual' as const,
    addedAt: now,
    reason: 'user-added' as const,
  };
  const previousAttempts =
    metadata.streamerRetryAttempts ??
    (state.appState.recoveryReason === 'no-streamers'
      ? Math.max(0, state.appState.recoveryAttempts ?? 0)
      : 0);
  if (previousAttempts > 0) {
    state.appState.queueEntryMetadataByKey[selectedKey] = {
      ...metadata,
      streamerRetryAttempts: previousAttempts,
    };
  }
  if (state.apiBackoffUntil > now) {
    applyGlobalStreamerRecoveryState(state, getLastTwitchApiFailure(state)?.kind ?? 'network');
    await opts?.onSaveState?.();
    if (opts?.isCurrent?.() === false) return false;
    await opts?.onSaveTimingState?.(state);
    return false;
  }
  if (acquisitionRecoveryActive && state.recoveryBackoffUntil > now) return false;
  let opened = false;
  try {
    opened = opts?.onOpenStreamer ? await opts.onOpenStreamer(opts.isCurrent ?? (() => true)) : false;
  } catch (error) {
    if (!(error instanceof TwitchDirectoryUnavailableError)) throw error;
    if (opts?.isCurrent?.() === false) return false;
    const failure = classifyTwitchApiFailure(error);
    if (state.appState.twitchSessionSyncState.status === 'blocked') return false;
    if (state.apiBackoffUntil <= Date.now()) applyApiBackoff(state, failure.retryAfterMs);
    applyGlobalStreamerRecoveryState(state, failure.kind);
    await opts?.onSaveState?.();
    if (opts?.isCurrent?.() === false) return false;
    await opts?.onSaveTimingState?.(state);
    return false;
  }
  if (opts?.isCurrent?.() === false) return false;
  if (opened) {
    clearStreamerAcquisitionRecoveryState(state);
    resetQueueAcquisitionRound(state);
    const selectedKey = gameKey(state.appState.selectedGame);
    const metadata = state.appState.queueEntryMetadataByKey[selectedKey];
    if (metadata) {
      const {
        streamerRetryAt: _retryAt,
        streamerRetryReason: _retryReason,
        streamerRetryAttempts: _attempts,
        ...retainedMetadata
      } = metadata;
      state.appState.queueEntryMetadataByKey[selectedKey] = retainedMetadata;
    }
    await opts?.onSaveState?.();
    if (opts?.isCurrent?.() === false) return false;
    await opts?.onSaveTimingState?.(state);
    return true;
  }
  if (previousAttempts >= MAX_NO_STREAMERS_RETRIES) {
    release();
    await opts?.onSkipCurrentGame?.('no-streamers', canTransition);
    if (opts?.isCurrent?.() === false) return false;
    await opts?.onSaveState?.();
    await opts?.onSaveTimingState?.(state);
    return false;
  }
  const attempts = previousAttempts + 1;
  state.appState.queueEntryMetadataByKey[selectedKey] = { ...metadata, streamerRetryAttempts: attempts };
  const retryAt = Date.now() + NO_STREAMERS_RETRY_MS;
  applyNoStreamersRecoveryState(state, retryAt, attempts);
  logWarn('No eligible streamer found for current Drops; scheduling one retry', {
    game: getGameDisplayLabel(state.appState.selectedGame),
    retryAt,
    attempts,
  });
  await opts?.onSaveState?.();
  if (opts?.isCurrent?.() === false) return false;
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
  if (
    !opened &&
    reason === 'stalled-progress' &&
    state.apiBackoffUntil <= Date.now() &&
    !state.appState.recoveryReason?.startsWith('twitch-')
  )
    await opts?.onSkipCurrentGame?.();
  if (!isCurrent()) return false;
  await opts?.onSaveState?.();
  if (!isCurrent()) return false;
  await opts?.onSaveTimingState?.(state);
  return opened;
}
