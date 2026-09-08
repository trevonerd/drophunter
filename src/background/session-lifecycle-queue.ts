import { haveAllDropsExpiredOrVanished } from '../shared/drops.ts';
import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import {
  promoteQueueHead,
  removeQueueEntriesForGame,
  removeQueueEntriesForHeadGame,
} from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  isKnownCompletedSelection,
  isWaitingForScheduledRewards,
  selectedFarmingCompleteGame,
  selectedGameMarkedCompleted,
} from './session-lifecycle-completion.ts';
import { refreshQueueHead } from './session-lifecycle-queue-refresh.ts';
import {
  isAutomaticFavoriteSession,
  parkBlockedCampaignAtQueueTail,
  rotateBlockedQueueHead,
} from './session-lifecycle-queue-selection.ts';
import {
  finalizeCompletedQueue,
  queueSkipCopy,
  resetNoProgressRotationAttempts,
  resetStreamTrackingState,
} from './session-lifecycle-stop.ts';
import type {
  AdvanceQueueOptions,
  QueueSkipReason,
  SkipCurrentGameOptions,
} from './session-lifecycle-types.ts';
import { isCampaignStallBlocked } from './stalled-campaign-block.ts';

function prepareQueueHead(state: ServiceWorkerState, clearPreviousDropsCount: boolean): TwitchGame | null {
  const nextGame = promoteQueueHead(state);
  if (!nextGame) {
    return null;
  }
  state.appState.completionNotified = false;
  state.invalidStreamChecks = 0;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  state.lastTrackedDropKey = null;
  state.lastProgressAdvanceAt = 0;
  if (clearPreviousDropsCount) {
    state.previousAllDropsCount = 0;
  }
  resetNoProgressRotationAttempts(state);
  return nextGame;
}

/**
 * A stall block is durable evidence that a campaign must not be selected again.
 * Keep it in the queue for later evidence-based recovery, while scanning the
 * remaining entries exactly once for a campaign that can be farmed now.
 */
function prepareNextEligibleQueueHead(
  state: ServiceWorkerState,
  clearPreviousDropsCount: boolean,
  restrictUnauthorizedManualContinuation: boolean,
): TwitchGame | null {
  let remainingCandidates = state.appState.queue.length;
  while (remainingCandidates > 0) {
    const queuedHead = state.appState.queue[0];
    if (
      queuedHead &&
      restrictUnauthorizedManualContinuation &&
      state.appState.queueEntryMetadataByKey[gameKey(queuedHead)]?.source !== 'favorite-auto'
    ) {
      return null;
    }
    const nextGame = prepareQueueHead(state, clearPreviousDropsCount);
    if (!nextGame) return null;
    if (!isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, nextGame)) {
      return nextGame;
    }
    rotateBlockedQueueHead(state);
    remainingCandidates -= 1;
  }
  return null;
}

export async function advanceQueueIfCompleted(
  state: ServiceWorkerState,
  options?: AdvanceQueueOptions,
): Promise<boolean> {
  if (!state.appState.isRunning || state.appState.isPaused) {
    return false;
  }
  if (isWaitingForScheduledRewards(state)) return true;

  const hasFarmablePending = state.appState.pendingDrops.some((drop) => isRewardFarmableNow(drop));
  const hasKnownNonFarmableRemainder =
    state.appState.pendingDrops.length > 0 && !hasFarmablePending && state.appState.currentDrop === null;
  const selectedMarkedCompleted = selectedGameMarkedCompleted(state);
  let terminalFarmingCompleteGame = selectedFarmingCompleteGame(state);
  const knownCompletedCurrent =
    terminalFarmingCompleteGame !== null ||
    hasKnownNonFarmableRemainder ||
    ((state.appState.allDrops.length > 0 || selectedMarkedCompleted) &&
      !hasFarmablePending &&
      state.appState.currentDrop === null);
  const campaignExpiredOrVanished =
    Boolean(state.appState.selectedGame && isExpiredGame(state.appState.selectedGame)) ||
    haveAllDropsExpiredOrVanished(state.appState.allDrops, state.previousAllDropsCount);
  logDebug('advanceQueueIfCompleted result', {
    knownCompletedCurrent,
    selectedMarkedCompleted,
    campaignExpiredOrVanished,
    shouldAdvance: knownCompletedCurrent || campaignExpiredOrVanished,
  });
  if (!knownCompletedCurrent && !campaignExpiredOrVanished) {
    return true;
  }
  if (campaignExpiredOrVanished && !knownCompletedCurrent) {
    logInfo('Campaign expired or vanished mid-farming — advancing queue', {
      selectedGame: state.appState.selectedGame ? getGameDisplayLabel(state.appState.selectedGame) : null,
      allDropsCount: state.appState.allDrops.length,
      previousAllDropsCount: state.previousAllDropsCount,
      queueLength: state.appState.queue.length,
    });
  }

  const completedWhileNoStreamers = state.appState.recoveryReason === 'no-streamers';
  const completedGameName = state.appState.selectedGame
    ? getGameDisplayLabel(state.appState.selectedGame)
    : 'current game';
  const restrictUnauthorizedManualContinuation = isAutomaticFavoriteSession(
    state,
    state.appState.selectedGame,
  );
  if (state.appState.selectedGame) {
    removeQueueEntriesForGame(state, state.appState.selectedGame);
  }

  while (state.appState.queue.length > 0) {
    const nextGame = prepareNextEligibleQueueHead(state, true, restrictUnauthorizedManualContinuation);
    if (!nextGame) {
      break;
    }
    await refreshQueueHead(state, options);
    if (isWaitingForScheduledRewards(state)) {
      await options?.onSaveState?.();
      return true;
    }
    const nextFarmingCompleteGame = selectedFarmingCompleteGame(state);
    const campaignExpiredNext =
      isExpiredGame(nextGame) ||
      haveAllDropsExpiredOrVanished(state.appState.allDrops, state.previousAllDropsCount);
    if (isKnownCompletedSelection(state, nextFarmingCompleteGame) || campaignExpiredNext) {
      if (nextFarmingCompleteGame) {
        terminalFarmingCompleteGame = nextFarmingCompleteGame;
      }
      state.previousAllDropsCount = 0;
      removeQueueEntriesForHeadGame(state, nextGame);
      continue;
    }
    if (options?.onOpenStreamer) {
      await options.onOpenStreamer();
    }
    if (options?.onSaveState) {
      await options.onSaveState();
    }
    return true;
  }

  await finalizeCompletedQueue(
    state,
    { completedWhileNoStreamers, completedGameName, terminalFarmingCompleteGame },
    options,
  );
  return false;
}

export async function skipCurrentGameAndAdvanceQueue(
  state: ServiceWorkerState,
  reason: QueueSkipReason = 'stalled-progress',
  options?: SkipCurrentGameOptions,
): Promise<void> {
  const skippedGame = state.appState.selectedGame;
  const gameName = skippedGame ? getGameDisplayLabel(skippedGame) : 'current game';
  const copy = queueSkipCopy(reason, gameName);
  const restrictUnauthorizedManualContinuation = isAutomaticFavoriteSession(state, skippedGame);
  logWarn(copy.logMessage, {
    game: gameName,
    reason,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
  });
  if (skippedGame) {
    if (
      reason === 'stalled-progress' &&
      isCampaignStallBlocked(state.appState.stalledCampaignBlocksByKey, skippedGame)
    ) {
      parkBlockedCampaignAtQueueTail(state, skippedGame);
    } else {
      removeQueueEntriesForGame(state, skippedGame);
    }
  }
  resetStreamTrackingState(state);

  while (state.appState.queue.length > 0) {
    const nextGame = prepareNextEligibleQueueHead(state, false, restrictUnauthorizedManualContinuation);
    if (!nextGame) {
      break;
    }
    await refreshQueueHead(state, options);
    if (isWaitingForScheduledRewards(state)) {
      await options?.onSaveState?.();
      return;
    }
    if (isExpiredGame(nextGame) || isKnownCompletedSelection(state, selectedFarmingCompleteGame(state))) {
      removeQueueEntriesForHeadGame(state, nextGame);
      continue;
    }
    if (options?.onOpenStreamer) {
      await options.onOpenStreamer();
    }
    await options?.onNotify?.(
      copy.skipNotificationTitle,
      `${copy.skipMessage} Now farming ${getGameDisplayLabel(nextGame)}.`,
    );
    if (options?.onSaveState) {
      await options.onSaveState();
    }
    return;
  }

  if (reason !== 'unverifiable-twitch') {
    state.appState.selectedGame = null;
  }
  state.appState.manualQueueAuthorized = false;
  if (options?.onStopFarmingSession) {
    await options.onStopFarmingSession({
      stopReason: copy.stopReason,
      stopMessage: copy.terminalMessage,
      notification: {
        title: copy.terminalNotificationTitle,
        message: copy.terminalNotificationMessage,
      },
    });
  }
}

export async function skipCurrentGameDueToStall(
  state: ServiceWorkerState,
  options?: SkipCurrentGameOptions,
): Promise<void> {
  return skipCurrentGameAndAdvanceQueue(state, 'stalled-progress', options);
}
