// Owns selection changes and their campaign-aware refresh/rebinding sequence.
import type { TwitchDrop, TwitchGame } from '../types';
import { rememberInspectedCampaignSummary } from './drops-projection-semantics.ts';
import { markQueueEntryManual } from './queue-operations';
import type { ServiceWorkerState } from './runtime-state.ts';

export interface HandleSetSelectedGameCallbacks {
  onTrackActivity: (reason: string) => Promise<void>;
  onEnsureWorkspace: () => Promise<void>;
  onRefreshDropsData: (opts?: {
    includeCampaignFetch?: boolean;
    includeInventoryFetch?: boolean;
    forceInventoryFetch?: boolean;
    suppressNotifications?: boolean;
  }) => Promise<void>;
  onOpenBestStreamer: () => Promise<boolean>;
  onSaveState: (state: ServiceWorkerState) => Promise<void>;
  onSaveTimingState: (state: ServiceWorkerState) => Promise<void>;
}

export interface HandleSetSelectedGameDeps {
  resolveGameFromState: (state: ServiceWorkerState, game: TwitchGame) => TwitchGame | null;
  removeGameFromQueue: (state: ServiceWorkerState, game: TwitchGame) => void;
  splitDropsForSelectedGame: (state: ServiceWorkerState, allDrops: TwitchDrop[]) => void;
  getGameDisplayLabel: (game: TwitchGame) => string;
  logDebug: (message: string, context?: unknown) => void;
  logWarn: (message: string, context?: unknown) => void;
}

export async function handleSetSelectedGame(
  state: ServiceWorkerState,
  payload: { game: TwitchGame },
  callbacks: HandleSetSelectedGameCallbacks,
  deps: HandleSetSelectedGameDeps,
): Promise<{ success: boolean; error?: string }> {
  await callbacks.onTrackActivity('set-selected-game');
  const selectedGame = deps.resolveGameFromState(state, payload.game);
  if (!selectedGame) {
    return { success: false, error: 'Campaign is no longer available.' };
  }
  deps.logDebug('Selected game changed', {
    payloadGameId: payload.game.id,
    payloadCampaignId: payload.game.campaignId ?? null,
    payloadGameName: deps.getGameDisplayLabel(payload.game),
    gameId: selectedGame.id,
    campaignId: selectedGame.campaignId ?? null,
    gameName: deps.getGameDisplayLabel(selectedGame),
    running: state.appState.isRunning,
    availableGames: state.appState.availableGames.length,
  });
  rememberInspectedCampaignSummary(state);
  state.appState.selectedGame = selectedGame;
  state.appState.completionNotified = false;
  state.invalidStreamChecks = 0;
  state.lastTrackedProgress = -1;
  state.lastTrackedMinutes = -1;
  state.lastTrackedDropKey = null;
  state.lastProgressAdvanceAt = 0;
  state.noProgressRotationAttempts = 0;
  if (state.appState.isRunning && !state.appState.isPaused) {
    deps.removeGameFromQueue(state, selectedGame);
    state.appState.queue = [selectedGame, ...state.appState.queue];
    markQueueEntryManual(state, selectedGame);
  }
  if (state.appState.isRunning && !state.appState.isPaused) {
    await callbacks.onEnsureWorkspace();
  }
  await callbacks.onRefreshDropsData({
    includeCampaignFetch: true,
    includeInventoryFetch: true,
    forceInventoryFetch: true,
    suppressNotifications: true,
  });
  rememberInspectedCampaignSummary(state);
  if (state.appState.selectedGame) {
    const canonicalSelected = deps.resolveGameFromState(state, state.appState.selectedGame);
    if (
      canonicalSelected &&
      (canonicalSelected.id !== state.appState.selectedGame.id ||
        canonicalSelected.campaignId !== state.appState.selectedGame.campaignId)
    ) {
      deps.logDebug('Selected game canonicalized after refresh', {
        previousId: state.appState.selectedGame.id,
        previousCampaignId: state.appState.selectedGame.campaignId ?? null,
        nextId: canonicalSelected.id,
        nextCampaignId: canonicalSelected.campaignId ?? null,
        name: deps.getGameDisplayLabel(canonicalSelected),
      });
      state.appState.selectedGame = canonicalSelected;
      deps.splitDropsForSelectedGame(
        state,
        state.cachedDropsSnapshot.length > 0 ? state.cachedDropsSnapshot : state.appState.allDrops,
      );
    }
  }
  if (state.appState.pendingDrops.length === 0 && state.appState.completedDrops.length === 0) {
    deps.logWarn('No rewards found after selected game refresh', {
      selectedGame: state.appState.selectedGame
        ? deps.getGameDisplayLabel(state.appState.selectedGame)
        : null,
      cachedDrops: state.cachedDropsSnapshot.length,
    });
  }
  if (state.appState.isRunning && !state.appState.isPaused) {
    state.appState.activeStreamer = null;
    await callbacks.onOpenBestStreamer();
  }
  await callbacks.onSaveState(state);
  await callbacks.onSaveTimingState(state);
  return { success: true };
}
