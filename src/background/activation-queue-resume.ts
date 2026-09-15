import type { ActivationSyncExecution } from './activation-sync-coordinator.ts';
import type { FarmingSessionHandlers } from './farming-session-handlers.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export function hasInterruptedQueue(state: ServiceWorkerState): boolean {
  const appState = state.appState;
  return (
    appState.wasRunning &&
    !appState.isRunning &&
    !appState.isPaused &&
    appState.lastStopReason !== 'user-stop' &&
    appState.selectedGame !== null
  );
}

export async function resumeInterruptedQueue(
  state: ServiceWorkerState,
  farmingSession: Pick<FarmingSessionHandlers, 'handleStartFarming'>,
  execution: ActivationSyncExecution,
): Promise<boolean> {
  const appState = state.appState;
  if (!execution.isCurrent() || !hasInterruptedQueue(state) || !appState.selectedGame) return true;
  const resumed = await farmingSession.handleStartFarming(
    { game: appState.selectedGame },
    execution.isCurrent,
    true,
  );
  if (execution.isCurrent() && resumed.success) state.appState.wasRunning = false;
  return resumed.success;
}
