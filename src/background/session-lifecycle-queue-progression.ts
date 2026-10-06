import { haveAllDropsExpiredOrVanished } from '../shared/drops.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import { removeQueueEntriesForHeadGame } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  isKnownCompletedSelection,
  isWaitingForScheduledRewards,
  selectedFarmingCompleteGame,
} from './session-lifecycle-completion.ts';
import { waitForParkedQueue } from './session-lifecycle-queue-parking.ts';
import { refreshQueueHead } from './session-lifecycle-queue-refresh.ts';
import {
  parkCampaignAtQueueTail,
  prepareNextEligibleQueueHead,
} from './session-lifecycle-queue-selection.ts';
import type { QueueProgressOptions } from './session-lifecycle-types.ts';

type QueueProgressionResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'advanced'; readonly game: TwitchGame; readonly opened: boolean }
  | {
      readonly kind: 'exhausted';
      readonly terminalFarmingCompleteGame: TwitchGame | null;
    };

type QueueProgressionRequest = {
  readonly restrictUnauthorizedManualContinuation: boolean;
  readonly terminalFarmingCompleteGame: TwitchGame | null;
  readonly hasScheduledWaiting?: boolean;
  readonly options?: QueueProgressOptions;
};

export async function progressFarmingQueue(
  state: ServiceWorkerState,
  request: QueueProgressionRequest,
): Promise<QueueProgressionResult> {
  let terminalFarmingCompleteGame = request.terminalFarmingCompleteGame;
  let hasScheduledWaiting = request.hasScheduledWaiting ?? false;
  let progressionOptions = request.options;

  while (state.appState.queue.length > 0) {
    if (progressionOptions?.isCurrent?.() === false) return { kind: 'cancelled' };
    const nextGame = prepareNextEligibleQueueHead(state, request.restrictUnauthorizedManualContinuation);
    if (!nextGame) break;
    const options = progressionOptions?.isCurrentAfterQueueAdvance
      ? {
          ...progressionOptions,
          isCurrent: () => progressionOptions?.isCurrentAfterQueueAdvance?.(nextGame) ?? false,
        }
      : progressionOptions;
    progressionOptions = options;
    if (options?.isCurrent?.() === false) return { kind: 'cancelled' };

    await refreshQueueHead(state, options);
    if (options?.isCurrent?.() === false) return { kind: 'cancelled' };
    if (isWaitingForScheduledRewards(state)) {
      markQueueCampaignAttempted(state, nextGame);
      parkCampaignAtQueueTail(state, nextGame);
      hasScheduledWaiting = true;
      await options?.onSaveState?.();
      continue;
    }

    const nextFarmingCompleteGame = selectedFarmingCompleteGame(state);
    const campaignExpiredOrVanished =
      isExpiredGame(nextGame) ||
      haveAllDropsExpiredOrVanished(state.appState.allDrops, state.previousAllDropsCount);
    if (isKnownCompletedSelection(state, nextFarmingCompleteGame) || campaignExpiredOrVanished) {
      terminalFarmingCompleteGame = nextFarmingCompleteGame ?? terminalFarmingCompleteGame;
      state.previousAllDropsCount = 0;
      removeQueueEntriesForHeadGame(state, nextGame);
      continue;
    }

    const opened = (await options?.onOpenStreamer?.(options.isCurrent)) ?? false;
    if (options?.isCurrent?.() === false) return { kind: 'cancelled' };
    await options?.onSaveState?.();
    return { kind: 'advanced', game: nextGame, opened };
  }

  if (await waitForParkedQueue(state, request.restrictUnauthorizedManualContinuation, progressionOptions)) {
    return { kind: 'waiting' };
  }
  if (hasScheduledWaiting && state.appState.queue.length > 0) {
    await progressionOptions?.onSaveState?.();
    return { kind: 'waiting' };
  }
  if (progressionOptions?.isCurrent?.() === false) return { kind: 'cancelled' };
  return { kind: 'exhausted', terminalFarmingCompleteGame };
}
