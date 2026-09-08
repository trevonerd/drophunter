import { browser } from '../shared/browser-api.ts';
import { gameKey } from '../shared/game-selection.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
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
  options?: RotateStreamerIfInvalidOptions,
) {
  if (!state.appState.selectedGame) return;
  const epoch = currentFarmingSessionEpoch(state);
  const generation = state.tickGeneration;
  const campaignKey = gameKey(state.appState.selectedGame);
  const isCurrent = () =>
    options?.isCurrent?.() !== false &&
    currentFarmingSessionEpoch(state) === epoch &&
    state.tickGeneration === generation &&
    (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null) === campaignKey;
  if (!isCurrent()) return;
  const opts = { ...options, isCurrent };
  if (!state.appState.tabId) {
    if (opts?.onTablessWatchActive?.()) return;
    await rotateForOpenFailed(state, opts);
    return;
  }
  const tab = await browser.tabs.get(state.appState.tabId).catch(() => null);
  if (!isCurrent()) return;
  if (!tab?.id) {
    state.appState.tabId = null;
    state.appState.activeStreamer = null;
    await rotateForOpenFailed(state, opts);
    return;
  }
  const context = opts?.onFetchStreamContext ? await opts.onFetchStreamContext(tab.id) : null;
  if (!isCurrent()) return;
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
  if (!isCurrent()) return;
  if (context.isLive) state.offlineChecks = 0;
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
      await opts.onRecoverStalledProgress({ kind: 'managed-tab', tabId: tab.id }, isCurrent);
      return;
    }
    await handleStalledProgress(state, tab, opts, now, stallThreshold);
    return;
  }
  await handleGenericInvalidStream(state, health, opts, now);
}
