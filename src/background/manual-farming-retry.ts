import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { restartQueueAcquisitionRound } from './queue-acquisition-round.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

interface RetryDependencies {
  readonly checkDropProgress: () => Promise<void>;
  readonly acquireStreamerForSelectedGame: () => Promise<boolean>;
  readonly saveState: () => Promise<void>;
}

export async function retryFarmingNow(state: ServiceWorkerState, dependencies: RetryDependencies) {
  if (!state.appState.isRunning || state.appState.isPaused || state.appState.lastStopReason === 'user-stop') {
    return { success: false, error: 'Start or resume farming before retrying.' };
  }
  if (state.apiBackoffUntil > Date.now()) {
    return {
      success: false,
      error: 'Twitch rate limit or network cooldown is still active. Retry after the displayed deadline.',
    };
  }
  if (state.monitorTickInFlight || state.streamerAcquisitionInFlight) {
    return { success: true };
  }
  const epoch = currentFarmingSessionEpoch(state);
  restartQueueAcquisitionRound(state);
  state.recoveryBackoffUntil = 0;
  state.appState.recoveryBackoffUntil = Date.now();
  await dependencies.saveState();
  if (currentFarmingSessionEpoch(state) !== epoch || !state.appState.isRunning || state.appState.isPaused)
    return { success: false, error: 'Retry was cancelled by a session change.' };
  await dependencies.checkDropProgress();
  return { success: true };
}
