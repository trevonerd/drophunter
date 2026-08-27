import { browser } from '../shared/browser-api.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import {
  type RotateStreamerIfInvalidOptions,
  rotateStreamerOptsFrom,
} from './streamer-acquisition-contracts.ts';
import {
  evaluateStreamHealth,
  handleGenericInvalidStream,
  handleMissingStreamContext,
  shouldKeepStreamerWhileDropProgresses,
} from './streamer-health-evaluation.ts';
import { handleOfflineStream, handleStalledProgress } from './streamer-recovery-handlers.ts';

async function rotateForOpenFailed(
  state: ServiceWorkerState,
  opts: RotateStreamerIfInvalidOptions | undefined,
): Promise<void> {
  if (
    state.recoveryBackoffUntil > 0 &&
    Date.now() < state.recoveryBackoffUntil &&
    (state.appState.recoveryReason === 'open-failed' || state.appState.recoveryReason === 'no-streamers')
  )
    return;
  await opts?.onRotateStreamer?.(state, 'open-failed', rotateStreamerOptsFrom(opts));
}

export async function rotateStreamerIfInvalid(
  state: ServiceWorkerState,
  opts?: RotateStreamerIfInvalidOptions,
) {
  if (!state.appState.selectedGame) return;
  if (!state.appState.tabId) {
    if (opts?.onTablessWatchActive?.()) return;
    await rotateForOpenFailed(state, opts);
    return;
  }
  const tab = await browser.tabs.get(state.appState.tabId).catch(() => null);
  if (!tab?.id) {
    state.appState.tabId = null;
    state.appState.activeStreamer = null;
    await rotateForOpenFailed(state, opts);
    return;
  }
  const context = opts?.onFetchStreamContext ? await opts.onFetchStreamContext(tab.id) : null;
  const now = Date.now();
  if (now < state.streamValidationGraceUntil) return;
  const effectiveThreshold = computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);
  if (!context) {
    await handleMissingStreamContext(state, tab, opts, now, effectiveThreshold);
    return;
  }
  const { health, stallThreshold } = await evaluateStreamHealth(
    state,
    context,
    effectiveThreshold,
    now,
    opts,
  );
  if (health.isHealthy) {
    state.invalidStreamChecks = 0;
    return;
  }
  if (health.forceImmediateRotation && health.reason === 'offline') {
    await handleOfflineStream(state, context, opts, now);
    return;
  }
  if (
    shouldKeepStreamerWhileDropProgresses({
      currentDrop: state.appState.currentDrop,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      now,
      effectiveThresholdMs: effectiveThreshold,
      reason: health.reason,
    })
  ) {
    logDebug('Stream validation failed but drop progress is active; keeping current streamer', {
      reason: health.reason,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      effectiveThresholdMs: effectiveThreshold,
      progress: state.appState.currentDrop?.progress ?? null,
      currentMinutes: state.appState.currentDrop?.currentMinutes ?? null,
      requiredMinutes: state.appState.currentDrop?.requiredMinutes ?? null,
    });
    state.invalidStreamChecks = 0;
    return;
  }
  if (health.reason === 'stalled-progress') {
    if (opts?.onRecoverStalledProgress) {
      await opts.onRecoverStalledProgress({ kind: 'managed-tab', tabId: tab.id });
      return;
    }
    await handleStalledProgress(state, tab, opts, now, stallThreshold);
    return;
  }
  await handleGenericInvalidStream(state, health, opts, now);
}
