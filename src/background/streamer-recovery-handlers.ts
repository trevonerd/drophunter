import { gameKey } from '../shared/game-selection.ts';
import { logDebug, logInfo } from './logging.ts';
import { clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { OFFLINE_CONFIRMATION_CHECKS } from './stream-rotation.ts';
import {
  type RotateStreamerIfInvalidOptions,
  rotateStreamerOptsFrom,
  type StreamContext,
} from './streamer-acquisition-contracts.ts';
import { MAX_STREAMER_ATTEMPTS } from './streamer-watch-attempt.ts';

export async function handleOfflineStream(
  state: ServiceWorkerState,
  context: Pick<StreamContext, 'channelName' | 'pageUrl'>,
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
  const channel = (state.appState.activeStreamer?.name ?? context.channelName).trim().toLowerCase();
  const game = state.appState.selectedGame;
  const metadata = game ? state.appState.queueEntryMetadataByKey[gameKey(game)] : undefined;
  if (game && metadata) {
    const { watchAttempt, ...retained } = metadata;
    state.appState.queueEntryMetadataByKey[gameKey(game)] = {
      ...retained,
      attemptedStreamerNames: metadata.attemptedStreamerNames?.filter((name) => name !== channel),
      ...(watchAttempt && watchAttempt.channelName !== channel ? { watchAttempt } : {}),
    };
  }
  state.avoidStreamerName = channel;
  await opts?.onSaveState?.();
  if (opts?.isCurrent?.() === false) return;
  await opts?.onSaveTimingState?.(state);
  if (opts?.isCurrent?.() === false) return;
  state.invalidStreamChecks = 0;
  logInfo('Offline stream detected, rotating immediately', {
    channel: state.appState.activeStreamer?.name ?? context.channelName,
    pageUrl: context.pageUrl,
  });
  await opts?.onRotateStreamer?.(state, 'offline', rotateStreamerOptsFrom(opts));
}

export async function handleStalledProgress(
  state: ServiceWorkerState,
  _tab: { id?: number },
  opts: RotateStreamerIfInvalidOptions | undefined,
  _now: number,
  _stallThreshold: number,
): Promise<void> {
  if (opts?.isCurrent?.() === false) return;
  const previousDrop = state.appState.currentDrop;
  // Production callers use the common recovery controller. This leaf path
  // still requires fresh inventory proof before treating a stall as confirmed.
  if ((await opts?.onForceRefreshDropsData?.(opts.isCurrent)) !== 'refreshed') return;
  if (opts?.isCurrent?.() === false || !state.appState.currentDrop) return;
  const currentDrop = state.appState.currentDrop;
  if (
    previousDrop &&
    currentDrop.id === previousDrop.id &&
    currentDrop.campaignId === previousDrop.campaignId &&
    (currentDrop.progress > previousDrop.progress ||
      (currentDrop.currentMinutes ?? -1) > (previousDrop.currentMinutes ?? -1))
  )
    return;
  const game = state.appState.selectedGame;
  if (
    game &&
    (state.appState.queueEntryMetadataByKey[gameKey(game)]?.attemptedStreamerNames?.length ?? 0) >=
      MAX_STREAMER_ATTEMPTS
  ) {
    await opts?.onSkipCurrentGame?.();
    return;
  }
  await opts?.onRotateStreamer?.(state, 'stalled-progress', rotateStreamerOptsFrom(opts));
}
