import { logInfo } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { saveState, saveTimingState } from './state-persistence.ts';

export interface StartupPauseSession {
  readonly pauseAfterRestart?: () => Promise<{ readonly success: true }>;
  readonly stopMonitoring: () => void;
}

export async function pauseFarmingAfterRestart(
  state: ServiceWorkerState,
  session: StartupPauseSession,
  now: number,
): Promise<void> {
  logInfo('Long browser restart detected; waiting for an explicit resume', {
    secondsAgo: Math.round((now - state.lastHeartbeatAt) / 1000),
  });
  if (session.pauseAfterRestart) {
    await session.pauseAfterRestart();
    return;
  }
  session.stopMonitoring();
  await saveState(state);
  await saveTimingState(state);
}
