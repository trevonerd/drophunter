import { dropMatchesGame, findMatchingGame } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { formatFarmingCompleteStatusLines } from '../shared/runtime-status.ts';
import { isExpiredGame } from '../shared/utils.ts';
import type { TwitchGame } from '../types/index.ts';
import { splitDropsForSelectedGame } from './drops-projection.ts';
import { cleanUnavailableQueueCampaigns } from './queue-availability-cleanup.ts';
import { notifyQueueCleanup, recordQueueCleanupActivity } from './queue-availability-cleanup-activity.ts';
import {
  markQueueEntryManual,
  normalizeQueueSelection,
  removeGameFromQueue,
  removeQueueEntriesForGame,
  resolveGameFromState,
} from './queue-operations.ts';
import { clearRecoveryState, clearStopState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { resetStreamTrackingState } from './session-lifecycle-stop.ts';
import type {
  StartFarmingOptions,
  StartFarmingPayload,
  StartFarmingResult,
} from './session-lifecycle-types.ts';
import { clearCampaignStallBlock } from './stalled-campaign-block.ts';

function startRejectionMessage(game: TwitchGame): string | null {
  const summary = game.rewardSummary;
  if (!summary || summary.completion === 'farmable') {
    return null;
  }
  if (summary.completion === 'all-acquired') {
    return 'All campaign rewards are already acquired.';
  }
  const statusLines = formatFarmingCompleteStatusLines(summary.remainderReasons);
  return statusLines.length > 0 ? statusLines.join('\n') : 'No automatable rewards remain for this campaign.';
}

export async function handleStartFarming(
  state: ServiceWorkerState,
  payload: StartFarmingPayload,
  options?: StartFarmingOptions,
): Promise<StartFarmingResult> {
  const isCurrent = options?.isCurrent ?? (() => true);
  const cancelled = (): StartFarmingResult => ({ success: false, error: 'Farming start was superseded.' });
  if (!isCurrent()) return cancelled();
  if (options?.onTrackActivity) {
    await options.onTrackActivity('start-farming');
    if (!isCurrent()) return cancelled();
  }
  const queueCleanup = cleanUnavailableQueueCampaigns(state);
  recordQueueCleanupActivity(state, queueCleanup);
  if (!payload?.game) {
    return { success: false, error: 'No game selected.' };
  }

  let requestedGame = resolveGameFromState(state, payload.game);
  if (!requestedGame) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  const initialRequestedGame = requestedGame;
  if (isExpiredGame(initialRequestedGame)) {
    if (options?.onSaveState) await options.onSaveState();
    await notifyQueueCleanup(queueCleanup, options ?? {});
    return { success: false, error: 'Campaign has expired.' };
  }
  const hasRequestedAutomatableReward = state.appState.pendingDrops.some(
    (drop) => dropMatchesGame(drop, initialRequestedGame) && isRewardFarmableNow(drop),
  );
  const requestedStartRejection = startRejectionMessage(initialRequestedGame);
  if (requestedStartRejection && !hasRequestedAutomatableReward) {
    return { success: false, error: requestedStartRejection };
  }

  if (options?.isCurrent) {
    if (options.onEnsureWorkspace) {
      await options.onEnsureWorkspace(isCurrent);
      if (!isCurrent()) return cancelled();
    }
    if (options.onRefreshDropsData) {
      await options.onRefreshDropsData({
        includeCampaignFetch: true,
        includeInventoryFetch: true,
        isCurrent,
        suppressNotifications: true,
      });
      if (!isCurrent()) return cancelled();
    }
  }

  if (!isCurrent()) return cancelled();
  requestedGame = resolveGameFromState(state, payload.game);
  if (!requestedGame) return { success: false, error: 'Campaign is no longer available.' };
  const refreshedRequestedGame = requestedGame;
  if (isExpiredGame(refreshedRequestedGame)) return { success: false, error: 'Campaign has expired.' };
  const refreshedRequestedStartRejection = startRejectionMessage(refreshedRequestedGame);
  const hasRefreshedRequestedReward = state.appState.pendingDrops.some(
    (drop) => dropMatchesGame(drop, refreshedRequestedGame) && isRewardFarmableNow(drop),
  );
  if (refreshedRequestedStartRejection && !hasRefreshedRequestedReward) {
    return { success: false, error: refreshedRequestedStartRejection };
  }
  if (!options?.preserveQueueContext) {
    removeQueueEntriesForGame(state, refreshedRequestedGame);
    state.appState.queue = [refreshedRequestedGame, ...state.appState.queue];
    markQueueEntryManual(state, refreshedRequestedGame);
  }
  normalizeQueueSelection(state, state.appState.availableGames);
  state.appState.selectedGame = options?.preserveQueueContext
    ? refreshedRequestedGame
    : (state.appState.queue[0] ?? refreshedRequestedGame);
  state.appState.isRunning = true;
  state.appState.isPaused = false;
  if (!options?.preserveQueueContext) {
    state.appState.manualQueueAuthorized = true;
    state.appState.farmingSessionOrigin = 'manual';
    state.appState.queueResumeOnAvailability = false;
    state.appState.forcedCampaignKey = null;
  }
  if (!options?.preserveQueueContext) {
    state.appState.stalledCampaignBlocksByKey = clearCampaignStallBlock(
      state.appState.stalledCampaignBlocksByKey,
      refreshedRequestedGame,
    );
  }
  state.appState.completionNotified = false;
  clearStopState(state);
  if (!options?.preserveQueueContext) clearRecoveryState(state);
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  resetStreamTrackingState(state, options?.preserveQueueContext);
  state.dropClaimRetryAtById.clear();
  state.dropClaimInFlight = false;
  state.monitorTickInFlight = false;
  state.tickGeneration += 1;

  if (options?.isCurrent) {
    if (!isCurrent()) return cancelled();
    splitDropsForSelectedGame(state, state.cachedDropsSnapshot);
  }

  if (!options?.isCurrent && options?.onEnsureWorkspace) {
    await options.onEnsureWorkspace();
  }
  if (!options?.isCurrent && options?.onRefreshDropsData) {
    await options.onRefreshDropsData({
      includeCampaignFetch: true,
      includeInventoryFetch: true,
      suppressNotifications: true,
    });
  }

  const hasFarmablePendingNow = state.appState.pendingDrops.some(isRewardFarmableNow);
  const selectedGame = state.appState.selectedGame
    ? (findMatchingGame(state.appState.selectedGame, state.appState.availableGames) ??
      state.appState.selectedGame)
    : null;
  const selectedStartRejection =
    !hasFarmablePendingNow && selectedGame ? startRejectionMessage(selectedGame) : null;
  if (selectedStartRejection || (!hasFarmablePendingNow && state.appState.currentDrop === null)) {
    if (options?.preserveQueueContext) {
      state.appState.isRunning = false;
      if (isCurrent()) await options.onSaveState?.();
      return { success: false, error: selectedStartRejection ?? 'Campaign rewards require validation.' };
    }
    removeGameFromQueue(state, requestedGame);
    state.appState.isRunning = false;
    state.appState.isPaused = false;
    state.appState.selectedGame = null;
    state.appState.manualQueueAuthorized = false;
    state.appState.farmingSessionOrigin = null;
    if (options?.onStopMonitoring) {
      options.onStopMonitoring();
    }
    if (options?.onSaveState) {
      if (!isCurrent()) return cancelled();
      await options.onSaveState();
    }
    await notifyQueueCleanup(queueCleanup, options ?? {});
    if (options?.onBroadcastStateUpdate) {
      options.onBroadcastStateUpdate();
    }
    return {
      success: false,
      error: selectedStartRejection ?? 'No farmable drops for this game.',
    };
  }

  if (options?.onSaveState) {
    if (!isCurrent()) return cancelled();
    await options.onSaveState();
  }
  if (!isCurrent()) return cancelled();
  await notifyQueueCleanup(queueCleanup, options ?? {});
  return { success: true };
}
