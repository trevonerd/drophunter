import type { TwitchGame } from '../types/index.ts';
import { cloneCampaignWorkingState } from './farming-campaign-transition.ts';
import type { QueueProgressionExecution } from './farming-queue-progression-execution.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import { removeQueueEntriesForHeadGame } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { parkCampaignForStreamerRetry, waitForParkedQueue } from './session-lifecycle-queue-parking.ts';
import {
  parkCampaignAtQueueTail,
  prepareNextEligibleQueueHead,
} from './session-lifecycle-queue-selection.ts';

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
  let hasScheduledWaiting = request.hasScheduledWaiting ?? false;
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
    state.appState.stalledCampaignBlocksByKey = selection.appState.stalledCampaignBlocksByKey;
    state.appState.queue = selection.appState.queue;
    if (!candidate) break;
    const result = await options.onTransitionToCampaign(candidate, options.isCurrent);
    if (result.kind === 'cancelled' || !options.isCurrent()) return { kind: 'cancelled' };
    if (result.kind === 'started') return { kind: 'advanced', game: candidate };
    if (result.kind === 'completed') {
      removeQueueEntriesForHeadGame(state, candidate);
      continue;
    }
    if (result.kind === 'waiting') {
      markQueueCampaignAttempted(state, candidate);
      parkCampaignAtQueueTail(state, candidate);
      hasScheduledWaiting = true;
    } else {
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
