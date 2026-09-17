import { haveAllDropsExpiredOrVanished } from '../shared/drops.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { resetQueueAcquisitionRound } from './queue-acquisition-round.ts';
import { removeQueueEntriesForHeadGame } from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  isKnownCompletedSelection,
  isWaitingForScheduledRewards,
  selectedFarmingCompleteGame,
} from './session-lifecycle-completion.ts';
import { waitForParkedQueue } from './session-lifecycle-queue-parking.ts';
import { refreshQueueHead } from './session-lifecycle-queue-refresh.ts';
import { prepareNextEligibleQueueHead } from './session-lifecycle-queue-selection.ts';
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
  readonly options?: QueueProgressOptions;
};

export async function progressFarmingQueue(
  state: ServiceWorkerState,
  request: QueueProgressionRequest,
): Promise<QueueProgressionResult> {
  let terminalFarmingCompleteGame = request.terminalFarmingCompleteGame;

  while (state.appState.queue.length > 0) {
    const nextGame = prepareNextEligibleQueueHead(state, request.restrictUnauthorizedManualContinuation);
    if (!nextGame) break;

    await refreshQueueHead(state, request.options);
    if (request.options?.isCurrent?.() === false) return { kind: 'cancelled' };
    if (isWaitingForScheduledRewards(state)) {
      await request.options?.onSaveState?.();
      return { kind: 'waiting' };
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

    const opened = (await request.options?.onOpenStreamer?.(request.options.isCurrent)) ?? false;
    if (request.options?.isCurrent?.() === false) return { kind: 'cancelled' };
    if (opened) resetQueueAcquisitionRound(state);
    await request.options?.onSaveState?.();
    return { kind: 'advanced', game: nextGame, opened };
  }

  if (await waitForParkedQueue(state, request.restrictUnauthorizedManualContinuation, request.options)) {
    return { kind: 'waiting' };
  }
  if (request.options?.isCurrent?.() === false) return { kind: 'cancelled' };
  return { kind: 'exhausted', terminalFarmingCompleteGame };
}
