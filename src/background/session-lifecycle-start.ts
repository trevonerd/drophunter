import { dropMatchesGame, findMatchingGame } from '../shared/game-selection.ts';
import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import { formatFarmingCompleteStatusLines } from '../shared/runtime-status.ts';
import type { TwitchGame } from '../types/index.ts';
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
  if (options?.onTrackActivity) {
    await options.onTrackActivity('start-farming');
  }
  if (!payload?.game) {
    return { success: false, error: 'No game selected.' };
  }

  const requestedGame = resolveGameFromState(state, payload.game);
  if (!requestedGame) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  const hasRequestedAutomatableReward = state.appState.pendingDrops.some(
    (drop) => dropMatchesGame(drop, requestedGame) && isRewardFarmableNow(drop),
  );
  const requestedStartRejection = startRejectionMessage(requestedGame);
  if (requestedStartRejection && !hasRequestedAutomatableReward) {
    return { success: false, error: requestedStartRejection };
  }

  removeQueueEntriesForGame(state, requestedGame);
  state.appState.queue = [requestedGame, ...state.appState.queue];
  markQueueEntryManual(state, requestedGame);
  normalizeQueueSelection(state, state.appState.availableGames);
  state.appState.selectedGame = state.appState.queue[0] ?? requestedGame;
  state.appState.isRunning = true;
  state.appState.isPaused = false;
  state.appState.completionNotified = false;
  clearStopState(state);
  clearRecoveryState(state);
  state.appState.lastRotationReason = null;
  state.appState.lastRotationAt = null;
  resetStreamTrackingState(state);
  state.dropClaimRetryAtById.clear();
  state.dropClaimInFlight = false;
  state.monitorTickInFlight = false;
  state.tickGeneration += 1;

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

  const hasFarmablePendingNow = state.appState.pendingDrops.some(isRewardFarmableNow);
  const selectedGame = state.appState.selectedGame
    ? (findMatchingGame(state.appState.selectedGame, state.appState.availableGames) ??
      state.appState.selectedGame)
    : null;
  const selectedStartRejection =
    !hasFarmablePendingNow && selectedGame ? startRejectionMessage(selectedGame) : null;
  if (selectedStartRejection || (!hasFarmablePendingNow && state.appState.currentDrop === null)) {
    removeGameFromQueue(state, requestedGame);
    state.appState.isRunning = false;
    state.appState.isPaused = false;
    state.appState.selectedGame = null;
    if (options?.onStopMonitoring) {
      options.onStopMonitoring();
    }
    if (options?.onSaveState) {
      await options.onSaveState();
    }
    if (options?.onBroadcastStateUpdate) {
      options.onBroadcastStateUpdate();
    }
    return {
      success: false,
      error: selectedStartRejection ?? 'No farmable drops for this game.',
    };
  }

  if (options?.onSaveState) {
    await options.onSaveState();
  }
  return { success: true };
}
