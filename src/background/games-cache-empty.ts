import type { GamesCacheRefreshDeps } from './games-cache-contracts.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export async function applyAuthoritativeEmptyCampaignRefresh(
  state: ServiceWorkerState,
  deps: GamesCacheRefreshDeps,
  preserveTerminalStop = false,
): Promise<void> {
  if (!state.appState.isRunning && !preserveTerminalStop) {
    state.appState = deps.clearTerminalStopStatus(deps.clearRecoveryStatus(state.appState));
  }
  deps.resetStateForAuthoritativeEmptyCampaign(state);
  state.appState.lastSuccessfulRefreshAt = Date.now();
  if (!state.appState.isRunning) deps.resetStreamTrackingState(state);
  state.lastGamesCacheRefreshAt = Date.now();
  await deps.saveState(state);
}
