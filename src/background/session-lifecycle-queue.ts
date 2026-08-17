import { haveAllDropsExpiredOrVanished } from '../shared/drops.ts';
import { dropMatchesGame, findMatchingGame, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { TwitchGame } from '../types/index.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import {
  promoteQueueHead,
  removeQueueEntriesForGame,
  removeQueueEntriesForHeadGame,
} from './queue-operations.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  finalizeCompletedQueue,
  queueSkipCopy,
  resetNoProgressRotationAttempts,
  resetStreamTrackingState,
} from './session-lifecycle-stop.ts';
import type {
  AdvanceQueueOptions,
  QueueProgressOptions,
  QueueSkipReason,
  SkipCurrentGameOptions,
} from './session-lifecycle-types.ts';
import { saveTimingState as saveTimingStateExt } from './state-persistence.ts';

function selectedGameMarkedCompleted(state: ServiceWorkerState): boolean {
  const selectedGame = state.appState.selectedGame;
  if (!selectedGame) {
    return false;
  }
  if (selectedGame.allDropsCompleted === true) {
    return true;
  }
  return findMatchingGame(selectedGame, state.appState.availableGames)?.allDropsCompleted === true;
}

function selectedFarmingCompleteGame(state: ServiceWorkerState): TwitchGame | null {
  const selectedGame = state.appState.selectedGame;
  if (!selectedGame) {
    return null;
  }
  const hasCurrentAutomatableReward = state.appState.pendingDrops.some(
    (drop) => dropMatchesGame(drop, selectedGame) && isRewardFarmableNow(drop),
  );
  if (hasCurrentAutomatableReward) {
    return null;
  }
  const currentGame = findMatchingGame(selectedGame, state.appState.availableGames) ?? selectedGame;
  return currentGame.rewardSummary?.completion === 'farming-complete' ? currentGame : null;
}

function isKnownCompletedSelection(
  state: ServiceWorkerState,
  farmingCompleteGame: TwitchGame | null,
): boolean {
  const hasFarmablePending = state.appState.pendingDrops.some(isRewardFarmableNow);
  return (
    farmingCompleteGame !== null ||
    ((state.appState.allDrops.length > 0 || selectedGameMarkedCompleted(state)) &&
      !hasFarmablePending &&
      state.appState.currentDrop === null)
  );
}

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

async function refreshQueueHead(state: ServiceWorkerState, options?: QueueProgressOptions): Promise<void> {
  if (options?.onSaveTimingState) {
    await options.onSaveTimingState(state);
  } else {
    saveTimingStateExt(state).catch(() => undefined);
  }
  if (options?.onEnsureWorkspace) {
    await options.onEnsureWorkspace();
  }
  if (options?.onRefreshDropsData) {
    await options.onRefreshDropsData({
      includeCampaignFetch: true,
      includeInventoryFetch: true,
      suppressNotifications: true,
    });
  }
}

export async function advanceQueueIfCompleted(
  state: ServiceWorkerState,
  options?: AdvanceQueueOptions,
): Promise<boolean> {
  if (!state.appState.isRunning || state.appState.isPaused) {
    return false;
  }

  const hasFarmablePending = state.appState.pendingDrops.some(isRewardFarmableNow);
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
  const campaignExpiredOrVanished = haveAllDropsExpiredOrVanished(
    state.appState.allDrops,
    state.previousAllDropsCount,
  );
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
  if (state.appState.selectedGame) {
    removeQueueEntriesForGame(state, state.appState.selectedGame);
  }

  while (state.appState.queue.length > 0) {
    const nextGame = prepareQueueHead(state, true);
    if (!nextGame) {
      break;
    }
    await refreshQueueHead(state, options);
    const nextFarmingCompleteGame = selectedFarmingCompleteGame(state);
    const campaignExpiredNext = haveAllDropsExpiredOrVanished(
      state.appState.allDrops,
      state.previousAllDropsCount,
    );
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
  logWarn(copy.logMessage, {
    game: gameName,
    reason,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
  });
  if (skippedGame) {
    removeQueueEntriesForGame(state, skippedGame);
  }
  resetStreamTrackingState(state);

  while (state.appState.queue.length > 0) {
    const nextGame = prepareQueueHead(state, false);
    if (!nextGame) {
      break;
    }
    await refreshQueueHead(state, options);
    if (isKnownCompletedSelection(state, selectedFarmingCompleteGame(state))) {
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
