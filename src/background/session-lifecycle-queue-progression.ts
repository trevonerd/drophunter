import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame } from '../types/index.ts';
import { cloneCampaignWorkingState } from './farming-campaign-transition.ts';
import { reconcileFarmingSessionTargets, unresolvedFarmingTargets } from './farming-session-targets.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import { removeQueueEntriesForHeadGame } from './queue-operations.ts';
import { applyRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { hasCompletedCampaignWatchTime } from './session-lifecycle-completion.ts';
import { parkCampaignForStreamerRetry, waitForParkedQueue } from './session-lifecycle-queue-parking.ts';
import {
  parkCampaignAtQueueTail,
  prepareNextEligibleQueueHead,
} from './session-lifecycle-queue-selection.ts';
import type { QueueProgressionExecution } from './session-lifecycle-types.ts';
import { MAX_STREAMER_ATTEMPTS } from './streamer-watch-attempt.ts';

type QueueProgressionResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'advanced'; readonly game: TwitchGame }
  | { readonly kind: 'exhausted'; readonly terminalFarmingCompleteGame: TwitchGame | null };

type QueueProgressionRequest = {
  readonly restrictUnauthorizedManualContinuation: boolean;
  readonly terminalFarmingCompleteGame: TwitchGame | null;
  readonly hasScheduledWaiting?: boolean;
  readonly options: QueueProgressionExecution;
};

export async function progressFarmingQueue(
  state: ServiceWorkerState,
  request: QueueProgressionRequest,
): Promise<QueueProgressionResult> {
  const { options } = request;
  reconcileFarmingSessionTargets(state);
  for (const target of unresolvedFarmingTargets(state))
    if (
      !hasCompletedCampaignWatchTime(state, target) &&
      !state.appState.queue.some((game) => gameKey(game) === gameKey(target))
    )
      state.appState.queue.push(target);
  let hasScheduledWaiting = request.hasScheduledWaiting ?? false;
  const failedPreparations = new Map<string, number>();
  while (state.appState.queue.length > 0) {
    if (!options.isCurrent()) return { kind: 'cancelled' };
    const selection = cloneCampaignWorkingState(state);
    const candidate = prepareNextEligibleQueueHead(
      selection,
      request.restrictUnauthorizedManualContinuation,
      options.now(),
    );
    state.appState.queueAcquisitionRound = selection.appState.queueAcquisitionRound;
    state.appState.queueEntryMetadataByKey = selection.appState.queueEntryMetadataByKey;
    state.appState.queue = selection.appState.queue;
    if (!candidate) break;
    if (state.appState.farmingSessionTargets[gameKey(candidate)]?.acquired) {
      removeQueueEntriesForHeadGame(state, candidate);
      continue;
    }
    const result = await options.onTransitionToCampaign(candidate, options.isCurrent);
    if (result.kind === 'cancelled' || !options.isCurrent()) return { kind: 'cancelled' };
    if (result.kind === 'started') return { kind: 'advanced', game: candidate };
    if (result.kind === 'preparing') {
      state.recoveryBackoffUntil = result.retryAt;
      applyRecoveryState(state, 'open-failed', result.retryAt);
      state.appState.queueAcquisitionRound = {
        attemptedCampaignKeys: state.appState.queueAcquisitionRound?.attemptedCampaignKeys ?? [],
        nextRoundAt: result.retryAt,
      };
      await options.onSaveState();
      return { kind: 'waiting' };
    }
    if (result.kind === 'completed') {
      const game = result.game ?? candidate;
      const target = state.appState.farmingSessionTargets[gameKey(candidate)];
      if (target)
        state.appState.farmingSessionTargets[gameKey(candidate)] = {
          game,
          acquired: target.acquired || isCampaignAcquired(game),
        };
      removeQueueEntriesForHeadGame(state, candidate);
      continue;
    }
    if (result.kind === 'waiting') {
      markQueueCampaignAttempted(state, candidate);
      parkCampaignAtQueueTail(state, candidate);
      hasScheduledWaiting = true;
    } else {
      const failures = (failedPreparations.get(gameKey(candidate)) ?? 0) + 1;
      failedPreparations.set(gameKey(candidate), failures);
      if (
        result.reason === 'open-failed' &&
        !result.alternativesExhausted &&
        result.failedStreamerName &&
        failures < MAX_STREAMER_ATTEMPTS &&
        (state.appState.queueEntryMetadataByKey[gameKey(candidate)]?.attemptedStreamerNames?.length ?? 0) <
          MAX_STREAMER_ATTEMPTS
      )
        continue;
      await options.onCampaignFailure(candidate, result.reason);
      if (!options.isCurrent()) return { kind: 'cancelled' };
      parkCampaignForStreamerRetry(state, candidate, result.reason, false, options.now());
    }
    await options.onSaveState();
  }
  if (!options.isCurrent()) return { kind: 'cancelled' };
  if (await waitForParkedQueue(state, request.restrictUnauthorizedManualContinuation, options))
    return { kind: 'waiting' };
  if (hasScheduledWaiting && state.appState.queue.length > 0) {
    await options.onSaveState();
    return { kind: 'waiting' };
  }
  if (!options.isCurrent()) return { kind: 'cancelled' };
  return { kind: 'exhausted', terminalFarmingCompleteGame: request.terminalFarmingCompleteGame };
}
