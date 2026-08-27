import { haveAllDropsExpiredOrVanished } from '../shared/drops.ts';
import { normalizeToken } from '../shared/matching.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { TwitchDrop } from '../types';
import { INVALID_STREAM_THRESHOLD, STREAM_ROTATE_COOLDOWN_MS } from './constants.ts';
import { logDebug, logInfo } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  classifyStreamHealth,
  NO_DROPS_SIGNAL_STALL_THRESHOLD_MS,
  type StreamRotationReason,
} from './stream-rotation.ts';
import {
  type RotateStreamerIfInvalidOptions,
  rotateStreamerOptsFrom,
  type StreamContext,
} from './streamer-acquisition-contracts.ts';

export function shouldKeepStreamerWhileDropProgresses(input: {
  currentDrop: TwitchDrop | null;
  lastProgressAdvanceAt: number;
  now: number;
  effectiveThresholdMs: number;
  reason: StreamRotationReason | null;
}): boolean {
  const fatalReason =
    input.reason === 'offline' ||
    input.reason === 'navigated-away' ||
    input.reason === 'open-failed' ||
    input.reason === 'no-streamers' ||
    input.reason === 'stalled-progress';
  return (
    !fatalReason &&
    input.currentDrop != null &&
    input.lastProgressAdvanceAt > 0 &&
    input.now - input.lastProgressAdvanceAt < input.effectiveThresholdMs
  );
}

export async function handleMissingStreamContext(
  state: ServiceWorkerState,
  tab: { url?: string },
  opts: RotateStreamerIfInvalidOptions | undefined,
  now: number,
  effectiveThreshold: number,
): Promise<void> {
  const tabUrl = tab.url ?? '';
  const isStillOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(tabUrl);
  if (!isStillOnTwitch) {
    logInfo('Managed tab navigated away from Twitch', { tabUrl });
    state.invalidStreamChecks = INVALID_STREAM_THRESHOLD;
  } else if (
    shouldKeepStreamerWhileDropProgresses({
      currentDrop: state.appState.currentDrop,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      now,
      effectiveThresholdMs: effectiveThreshold,
      reason: 'missing-context',
    })
  ) {
    logDebug('Stream context missing but drop progress is recent; keeping current streamer', {
      tabUrl,
      lastProgressAdvanceAt: state.lastProgressAdvanceAt,
      effectiveThresholdMs: effectiveThreshold,
    });
    state.invalidStreamChecks = 0;
    return;
  } else state.invalidStreamChecks += 1;
  if (
    state.invalidStreamChecks < INVALID_STREAM_THRESHOLD ||
    now - state.lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS
  )
    return;
  state.invalidStreamChecks = 0;
  await opts?.onRotateStreamer?.(
    state,
    isStillOnTwitch ? 'missing-context' : 'navigated-away',
    rotateStreamerOptsFrom(opts),
  );
}

export async function evaluateStreamHealth(
  state: ServiceWorkerState,
  context: StreamContext,
  effectiveThreshold: number,
  now: number,
  opts: RotateStreamerIfInvalidOptions | undefined,
) {
  const sameChannel =
    !state.appState.activeStreamer || context.channelName === state.appState.activeStreamer.name;
  const hasDropsSignal = context.titleContainsDrops || context.hasDropsSignal;
  const selectedGame = state.appState.selectedGame;
  const selectedCategorySlug =
    selectedGame && opts?.onResolveCategorySlug
      ? normalizeToken(await opts.onResolveCategorySlug(selectedGame))
      : '';
  const contextCategorySlug = normalizeToken(context.categorySlug);
  const sameGame =
    selectedCategorySlug.length === 0 ||
    contextCategorySlug.length === 0 ||
    selectedCategorySlug === contextCategorySlug;
  const campaignGone = haveAllDropsExpiredOrVanished(state.appState.allDrops, state.previousAllDropsCount);
  const farmablePending = state.appState.pendingDrops.some(isRewardFarmableNow);
  const expectsDropsSignal =
    (state.appState.currentDrop != null && isRewardFarmableNow(state.appState.currentDrop)) ||
    farmablePending ||
    campaignGone;
  logDebug('Stream health inputs', {
    expectsDropsSignal,
    hasDropsSignal,
    campaignGone,
    currentDrop: !!state.appState.currentDrop,
    farmablePending,
  });
  const noDropsSignal = expectsDropsSignal && !hasDropsSignal;
  const stallThreshold = noDropsSignal
    ? Math.min(effectiveThreshold, NO_DROPS_SIGNAL_STALL_THRESHOLD_MS)
    : effectiveThreshold;
  const progressStalled =
    state.lastProgressAdvanceAt > 0 &&
    state.appState.currentDrop != null &&
    now - state.lastProgressAdvanceAt >= stallThreshold;
  const health = classifyStreamHealth({
    isLive: context.isLive,
    sameChannel,
    sameGame,
    hasDropsSignal,
    progressStalled,
    expectsDropsSignal,
  });
  if (context.isLive) state.offlineChecks = 0;
  return { health, stallThreshold };
}

export async function handleGenericInvalidStream(
  state: ServiceWorkerState,
  health: ReturnType<typeof classifyStreamHealth>,
  opts: RotateStreamerIfInvalidOptions | undefined,
  now: number,
): Promise<void> {
  state.invalidStreamChecks += health.invalidIncrement;
  if (
    state.invalidStreamChecks < INVALID_STREAM_THRESHOLD ||
    now - state.lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS
  )
    return;
  state.invalidStreamChecks = 0;
  if (opts?.onRotateStreamer && health.reason) {
    await opts.onRotateStreamer(state, health.reason, rotateStreamerOptsFrom(opts));
  }
}
