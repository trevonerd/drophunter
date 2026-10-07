import { isCampaignAcquired } from '../shared/campaign-eligibility.ts';
import { gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { isRewardAcquired } from '../shared/reward-semantics.ts';
import { isExpiredGame } from '../shared/utils.ts';
import { hasCompleteIdentifiedRewardSet } from './campaign-reward-identity.ts';
import type { QueueProgressionExecution } from './farming-queue-progression-execution.ts';
import { reconcileFarmingSessionTargets } from './farming-session-targets.ts';
import { logDebug, logInfo } from './logging.ts';
import { markQueueCampaignAttempted } from './queue-acquisition-round.ts';
import { removeQueueEntriesForGame } from './queue-operations.ts';
import { isQueueRecoveryReason } from './queue-recovery-activity.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  hasCompletedCampaignWatchTime,
  isWaitingForScheduledRewards,
  selectedGameMarkedCompleted,
} from './session-lifecycle-completion.ts';
import { parkCampaignForStreamerRetry } from './session-lifecycle-queue-parking.ts';
import { progressFarmingQueue } from './session-lifecycle-queue-progression.ts';
import { isAutomaticFavoriteSession, parkCampaignAtQueueTail } from './session-lifecycle-queue-selection.ts';
import {
  finalizeCompletedQueue,
  queueSkipLogMessage,
  resetStreamTrackingState,
} from './session-lifecycle-stop.ts';
import type { QueueSkipReason } from './session-lifecycle-types.ts';

export async function advanceQueueIfCompleted(
  state: ServiceWorkerState,
  options: QueueProgressionExecution,
): Promise<boolean> {
  if (options?.isCurrent?.() === false) return false;
  if (!state.appState.isRunning || state.appState.isPaused) {
    return false;
  }
  reconcileFarmingSessionTargets(state);
  const selected = state.appState.selectedGame;
  const watchComplete = selected !== null && hasCompletedCampaignWatchTime(state, selected);
  if (
    (state.appState.queueAcquisitionRound?.nextRoundAt ?? 0) > options.now() &&
    !watchComplete &&
    (!selected || (!isCampaignAcquired(selected) && !isExpiredGame(selected))) &&
    state.appState.farmingSessionTargets[selected ? gameKey(selected) : '']?.acquired !== true
  )
    return true;
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
  let terminalFarmingCompleteGame = null;
  const knownCompletedCurrent =
    selectedMarkedCompleted ||
    (state.appState.selectedGame !== null &&
      state.appState.allDrops.length > 0 &&
      hasCompleteIdentifiedRewardSet(state.appState.selectedGame, state.appState.allDrops, true) &&
      state.appState.allDrops.every(isRewardAcquired));
  const campaignExpiredOrVanished = Boolean(
    state.appState.selectedGame && isExpiredGame(state.appState.selectedGame),
  );
  logDebug('advanceQueueIfCompleted result', {
    knownCompletedCurrent,
    selectedMarkedCompleted,
    campaignExpiredOrVanished,
    shouldAdvance: knownCompletedCurrent || campaignExpiredOrVanished,
  });
  if (!knownCompletedCurrent && !campaignExpiredOrVanished) {
    if (watchComplete) {
      resetStreamTrackingState(state);
      const result = await progressFarmingQueue(state, {
        restrictUnauthorizedManualContinuation: isAutomaticFavoriteSession(state, selected),
        terminalFarmingCompleteGame: null,
        options,
      });
      return result.kind !== 'cancelled';
    }
    if (hasKnownNonFarmableRemainder) {
      await skipCurrentGameAndAdvanceQueue(state, 'no-streamers', options);
      return state.appState.isRunning;
    }
    return true;
  }
  if (
    !campaignExpiredOrVanished &&
    options?.isCampaignValidationCurrent &&
    !options.isCampaignValidationCurrent()
  ) {
    return true;
  }
  if (campaignExpiredOrVanished && !knownCompletedCurrent) {
    logInfo('Campaign expired mid-farming — advancing queue', {
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
    if (knownCompletedCurrent) {
      const key = gameKey(state.appState.selectedGame);
      const target = state.appState.farmingSessionTargets[key];
      if (target)
        state.appState.farmingSessionTargets[key] = {
          game: {
            ...target.game,
            allDropsCompleted: true,
            rewardSummary: { completion: 'all-acquired', remainderReasons: [] },
          },
          acquired: true,
        };
    }
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
  reconcileFarmingSessionTargets(state);
  const gameName = skippedGame ? getGameDisplayLabel(skippedGame) : 'current game';
  const restrictUnauthorizedManualContinuation = isAutomaticFavoriteSession(state, skippedGame);
  logInfo(queueSkipLogMessage(reason), {
    game: gameName,
    reason,
    stalledRecoveryAttempts: state.stalledRecoveryAttempts,
  });
  if (skippedGame) {
    if (state.appState.forcedCampaignKey === gameKey(skippedGame)) state.appState.forcedCampaignKey = null;
    if (!isCampaignAcquired(skippedGame) && !isExpiredGame(skippedGame)) {
      await options.onCampaignFailure?.(skippedGame, reason);
      if (!options.isCurrent()) return;
      parkCampaignForStreamerRetry(
        state,
        skippedGame,
        isQueueRecoveryReason(reason) ? reason : 'no-streamers',
        false,
        options.now(),
      );
    } else {
      removeQueueEntriesForGame(state, skippedGame);
    }
  }
  resetStreamTrackingState(state);
  await options.onSaveState();

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
    return;
  }
  await finalizeCompletedQueue(
    state,
    {
      completedWhileNoStreamers: false,
      completedGameName: gameName,
      terminalFarmingCompleteGame: null,
    },
    options,
  );
}
