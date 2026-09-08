import type { GamesCacheRefreshDeps } from './games-cache-contracts.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export async function applyAuthoritativeEmptyCampaignRefresh(
  state: ServiceWorkerState,
  deps: GamesCacheRefreshDeps,
  preserveTerminalStop = false,
): Promise<void> {
  if (state.appState.isRunning) {
    await deps.stopFarmingSession({
      stopReason: 'no-active-campaigns',
      stopMessage: 'No active Twitch Drops campaigns found.',
    });
  } else if (!preserveTerminalStop) {
    state.appState = deps.clearTerminalStopStatus(deps.clearRecoveryStatus(state.appState));
  }
  deps.resetStateForAuthoritativeEmptyCampaign(state);
  state.appState.lastSuccessfulRefreshAt = Date.now();
  deps.resetStreamTrackingState(state);
  state.lastGamesCacheRefreshAt = Date.now();
  await deps.saveState(state);
}
