import { gameKey } from '../shared/game-selection.ts';
import type { StreamContext } from './farming-session-context.ts';
import { logDebug, logInfo } from './logging.ts';
import { clearRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { OFFLINE_CONFIRMATION_CHECKS } from './stream-rotation.ts';
import type { RotateStreamerFn, RotateStreamerOptions } from './streamer-acquisition-contracts.ts';

export async function handleOfflineStream(
  state: ServiceWorkerState,
  context: Pick<StreamContext, 'channelName' | 'pageUrl'>,
  opts: RotateStreamerOptions & { readonly onRotateStreamer: RotateStreamerFn },
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
  await opts.onSaveState?.();
  if (opts.isCurrent?.() === false) return;
  await opts.onSaveTimingState?.(state);
  if (opts.isCurrent?.() === false) return;
  state.invalidStreamChecks = 0;
  logInfo('Offline stream detected, rotating immediately', {
    channel: state.appState.activeStreamer?.name ?? context.channelName,
    pageUrl: context.pageUrl,
  });
  await opts.onRotateStreamer(state, 'offline', opts);
}
