import { browser } from '../shared/browser-api.ts';
import { captureCampaignGuard } from './farming-session-revision.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { computeEffectiveStallThreshold } from './stream-rotation.ts';
import { type RotateStreamerIfInvalidOptions } from './streamer-acquisition-contracts.ts';
import {
  evaluateStreamHealth,
  handleGenericInvalidStream,
  handleMissingStreamContext,
  shouldKeepStreamerWhileDropProgresses,
} from './streamer-health-evaluation.ts';
import { handleOfflineStream } from './streamer-recovery-handlers.ts';
import { watchObservationStartedAt } from './streamer-watch-attempt.ts';

async function rotateForOpenFailed(
  state: ServiceWorkerState,
  opts: RotateStreamerIfInvalidOptions,
): Promise<void> {
  if (
    state.recoveryBackoffUntil > 0 &&
    Date.now() < state.recoveryBackoffUntil &&
    (state.appState.recoveryReason === 'open-failed' || state.appState.recoveryReason === 'no-streamers')
  )
    return;
  await opts.onRotateStreamer(state, 'open-failed', opts);
}

export async function rotateStreamerIfInvalid(
  state: ServiceWorkerState,
  options: RotateStreamerIfInvalidOptions,
) {
  if (!state.appState.selectedGame) return;
  const isCurrent = captureCampaignGuard(state, options.isCurrent);
  if (!isCurrent()) return;
  const opts = { ...options, isCurrent };
  if (!state.appState.tabId) {
    if (opts.onTablessWatchActive()) return;
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
  const context = await opts.onFetchStreamContext(tab.id);
  if (!isCurrent()) return;
  const now = Date.now();
  if (context?.isLive === false) {
    await handleOfflineStream(state, context, opts, now);
    return;
  }
  if (context?.isLive) state.offlineChecks = 0;
  if (now < state.streamValidationGraceUntil) return;
  const effectiveThreshold = computeEffectiveStallThreshold(state.appState.currentDrop?.requiredMinutes);
  if (state.appState.currentDrop && now - watchObservationStartedAt(state) >= effectiveThreshold) {
    await opts.onRecoverStalledProgress({ kind: 'managed-tab', tabId: tab.id }, isCurrent);
    return;
  }
  if (!context) {
    await handleMissingStreamContext(state, tab, opts, now, effectiveThreshold);
    return;
  }
  const health = await evaluateStreamHealth(state, context, effectiveThreshold, now, opts);
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
    await opts.onRecoverStalledProgress({ kind: 'managed-tab', tabId: tab.id }, isCurrent);
    return;
  }
  await handleGenericInvalidStream(state, health, opts, now);
}
