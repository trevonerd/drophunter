import { gameKey } from '../shared/game-selection.ts';
import { isStreamerAcquisitionRecovery } from '../shared/runtime-status.ts';
import { applyApiBackoff, getLastTwitchApiFailure } from './api-operations.ts';
import { EligibleStreamerDiscoveryUnavailableError } from './eligible-streamer-discovery.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import {
  applyDirectoryUnavailableRecoveryState,
  applyGlobalStreamerRecoveryState,
  applyPlaybackStartRecoveryState,
  clearStreamerAcquisitionRecoveryState,
} from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  NO_STREAMERS_RETRY_MS,
  nextNoProgressRotationAttempts,
  type StreamRotationReason,
} from './stream-rotation.ts';
import { runStreamerAcquisitionAttempt } from './streamer-acquisition-attempt.ts';
import type { RotateStreamerOptions } from './streamer-acquisition-contracts.ts';
import { NoEligibleStreamerError, WatchPlaybackUnavailableError } from './streamer-selection-flow.ts';
import { MAX_STREAMER_ATTEMPTS } from './streamer-watch-attempt.ts';
import { classifyTwitchApiFailure, TwitchDirectoryUnavailableError } from './twitch-api/errors.ts';

export type {
  OpenBestStreamerCallbacks,
  RotateStreamerIfInvalidOptions,
  RotateStreamerOptions,
} from './streamer-acquisition-contracts.ts';
export { openBestStreamerForSelectedGame } from './streamer-selection-flow.ts';
export { rotateStreamerIfInvalid } from './streamer-validation.ts';

interface AcquisitionOptions {
  onOpenStreamer?: (isCurrent: () => boolean) => Promise<boolean | 'cancelled' | 'preparing'>;
  onSkipCurrentGame?: (
    reason: 'no-streamers' | 'directory-unavailable' | 'open-failed' | 'stalled-progress',
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
  const attempts = () =>
    state.appState.queueEntryMetadataByKey[selectedKey]?.attemptedStreamerNames?.length ?? 0;
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
    const result = opts?.onOpenStreamer ? await opts.onOpenStreamer(opts.isCurrent ?? (() => true)) : false;
    if (result === 'cancelled') return false;
    if (result === 'preparing') {
      await opts?.onSaveState?.();
      if (opts?.isCurrent?.() !== false) await opts?.onSaveTimingState?.(state);
      return false;
    }
    opened = result;
  } catch (error) {
    if (error instanceof NoEligibleStreamerError) {
      if (opts?.isCurrent?.() === false) return false;
      release();
      await opts?.onSkipCurrentGame?.(
        state.appState.recoveryReason === 'stalled-progress' ? 'stalled-progress' : 'no-streamers',
        canTransition,
      );
      await opts?.onSaveState?.();
      if (canTransition()) await opts?.onSaveTimingState?.(state);
      return false;
    }
    if (error instanceof EligibleStreamerDiscoveryUnavailableError) {
      if (opts?.isCurrent?.() === false) return false;
      if (state.apiBackoffUntil > Date.now()) {
        applyGlobalStreamerRecoveryState(state, getLastTwitchApiFailure(state)?.kind ?? 'network');
        await opts?.onSaveState?.();
        if (opts?.isCurrent?.() === false) return false;
        await opts?.onSaveTimingState?.(state);
        return false;
      }
      const retryAt = Date.now() + NO_STREAMERS_RETRY_MS;
      applyDirectoryUnavailableRecoveryState(state, retryAt, attempts());
      await opts?.onSaveState?.();
      if (opts?.isCurrent?.() === false) return false;
      await opts?.onSaveTimingState?.(state);
      return false;
    }
    if (error instanceof WatchPlaybackUnavailableError) {
      if (opts?.isCurrent?.() === false) return false;
      if (attempts() >= MAX_STREAMER_ATTEMPTS || error.alternativesExhausted) {
        release();
        await opts?.onSkipCurrentGame?.(
          state.appState.recoveryReason === 'stalled-progress' ? 'stalled-progress' : 'open-failed',
          canTransition,
        );
      } else {
        applyPlaybackStartRecoveryState(state, Date.now() + NO_STREAMERS_RETRY_MS, attempts());
      }
      await opts?.onSaveState?.();
      if (opts?.isCurrent?.() === false) return false;
      await opts?.onSaveTimingState?.(state);
      return false;
    }
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
    const selectedKey = gameKey(state.appState.selectedGame);
    const metadata = state.appState.queueEntryMetadataByKey[selectedKey];
    if (metadata) {
      const { streamerWaitState: _waitState, ...retainedMetadata } = metadata;
      state.appState.queueEntryMetadataByKey[selectedKey] = retainedMetadata;
    }
    await opts?.onSaveState?.();
    if (opts?.isCurrent?.() === false) return false;
    await opts?.onSaveTimingState?.(state);
    return true;
  }
  release();
  await opts?.onSkipCurrentGame?.('no-streamers', canTransition);
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
  const previousStreamer = state.appState.activeStreamer;
  const previousAvoid = state.avoidStreamerName;
  if (previousStreamer?.name) state.avoidStreamerName = previousStreamer.name;
  let opened = false;
  try {
    opened = opts?.onOpenStreamer ? await opts.onOpenStreamer(isCurrent) : false;
  } catch (error) {
    if (!isCurrent()) return false;
    throw error;
  }
  if (!isCurrent()) return false;
  if (!opened) {
    state.avoidStreamerName = previousAvoid;
    return false;
  }
  if (
    previousStreamer?.name &&
    state.appState.activeStreamer?.name.toLowerCase() === previousStreamer.name.toLowerCase()
  ) {
    state.avoidStreamerName = previousAvoid;
    return false;
  }
  const now = Date.now();
  state.noProgressRotationAttempts = nextNoProgressRotationAttempts(state.noProgressRotationAttempts, reason);
  state.appState.lastRotationReason = reason;
  state.appState.lastRotationAt = now;
  state.lastStreamRotationAt = now;
  state.offlineChecks = 0;
  if (!isCurrent()) return false;
  await opts?.onSaveState?.();
  if (!isCurrent()) return false;
  await opts?.onSaveTimingState?.(state);
  return opened;
}
