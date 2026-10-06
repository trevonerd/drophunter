import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { haveAllDropsExpiredOrVanished } from '../shared/drops.ts';
import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { QueueProgressionExecution } from './farming-queue-progression-execution.ts';
import { logDebug, logInfo, logWarn } from './logging.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import { removeQueueEntriesForGame } from './queue-operations.ts';
import { isQueueRecoveryReason, recordQueueRecoveryActivity } from './queue-recovery-activity.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  isWaitingForScheduledRewards,
  selectedFarmingCompleteGame,
  selectedGameMarkedCompleted,
} from './session-lifecycle-completion.ts';
import { parkCampaignForStreamerRetry } from './session-lifecycle-queue-parking.ts';
import { progressFarmingQueue } from './session-lifecycle-queue-progression.ts';
import { isAutomaticFavoriteSession, parkCampaignAtQueueTail } from './session-lifecycle-queue-selection.ts';
import { finalizeCompletedQueue, queueSkipCopy, resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type { QueueSkipReason } from './session-lifecycle-types.ts';

export async function advanceQueueIfCompleted(
  state: ServiceWorkerState,
  options: QueueProgressionExecution,
): Promise<boolean> {
  if (options?.isCurrent?.() === false) return false;
  if (!state.appState.isRunning || state.appState.isPaused) {
    return false;
  }
  if (isWaitingForScheduledRewards(state)) {
    const scheduledGame = state.appState.selectedGame;
    if (!scheduledGame) return true;
    markQueueCampaignAttempted(state, scheduledGame);
    parkCampaignAtQueueTail(state, scheduledGame);
    const progression = await progressFarmingQueue(state, {
      restrictUnauthorizedManualContinuation: isAutomaticFavoriteSession(state, scheduledGame),
      terminalFarmingCompleteGame: null,
      hasScheduledWaiting: true,
      options,
    });
    if (progression.kind === 'waiting') await options?.onSaveState?.();
    if (progression.kind === 'exhausted') {
      await finalizeCompletedQueue(
        state,
        {
          completedWhileNoStreamers: false,
          completedGameName: getGameDisplayLabel(scheduledGame),
          terminalFarmingCompleteGame: progression.terminalFarmingCompleteGame,
        },
        options,
      );
      return false;
    }
    return progression.kind !== 'cancelled';
  }

  const hasFarmablePending = state.appState.pendingDrops.some((drop) =>
    isRewardFarmableNow(drop, options.now()),
  );
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
  if (options?.isCampaignValidationCurrent && !options.isCampaignValidationCurrent()) {
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

  const progression = await progressFarmingQueue(state, {
    restrictUnauthorizedManualContinuation,
    terminalFarmingCompleteGame,
    options,
  });
  if (progression.kind === 'cancelled') return false;
  if (progression.kind !== 'exhausted') return true;
  terminalFarmingCompleteGame = progression.terminalFarmingCompleteGame;
  await finalizeCompletedQueue(
    state,
    { completedWhileNoStreamers, completedGameName, terminalFarmingCompleteGame },
    options,
  );
  return false;
}

export async function skipCurrentGameAndAdvanceQueue(
  state: ServiceWorkerState,
  reason: QueueSkipReason,
  options: QueueProgressionExecution,
): Promise<void> {
  if (options?.isCurrent?.() === false) return;
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
    if (state.appState.forcedCampaignKey === gameKey(skippedGame)) state.appState.forcedCampaignKey = null;
    if (isQueueRecoveryReason(reason) && campaignRejectionReason(skippedGame) === null) {
      parkCampaignForStreamerRetry(state, skippedGame, reason, false, options.now());
    } else {
      removeQueueEntriesForGame(state, skippedGame);
    }
  }
  resetStreamTrackingState(state);

  const progression = await progressFarmingQueue(state, {
    restrictUnauthorizedManualContinuation,
    terminalFarmingCompleteGame: null,
    options,
  });
  if (progression.kind === 'cancelled') return;
  if (progression.kind === 'waiting') {
    return;
  }
  if (progression.kind === 'advanced') {
    if (skippedGame && isQueueRecoveryReason(reason)) {
      recordQueueRecoveryActivity(state, skippedGame, reason, {
        kind: 'advanced',
        nextGame: progression.game,
      });
      await options?.onSaveState?.();
      if (options?.isCurrent?.() === false) return;
    }
    if (state.appState.selectedGame && gameKey(state.appState.selectedGame) === gameKey(progression.game)) {
      await options?.onNotify?.(
        copy.skipNotificationTitle,
        `${copy.skipMessage} Now farming ${getGameDisplayLabel(progression.game)}.`,
      );
      if (options?.isCurrent?.() === false) return;
    }
    return;
  }
  if (reason !== 'unverifiable-twitch') {
    state.appState.selectedGame = null;
  }
  state.appState.manualQueueAuthorized = false;
  if (skippedGame && isQueueRecoveryReason(reason)) {
    recordQueueRecoveryActivity(state, skippedGame, reason, { kind: 'stopped' });
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
