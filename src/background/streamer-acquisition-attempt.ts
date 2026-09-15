import { gameKey } from '../shared/game-selection.ts';
import { applyApiBackoff } from './api-operations.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { logWarn } from './logging.ts';
import { applyGlobalStreamerRecoveryState } from './recovery-state.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

const ACQUISITION_TIMEOUT_MS = 60_000;

export function runStreamerAcquisitionAttempt(
  state: ServiceWorkerState,
  operation: (isCurrent: () => boolean, release: () => void) => Promise<boolean>,
  callbacks: {
    readonly isCurrent?: () => boolean;
    readonly onSaveState?: () => Promise<void>;
    readonly onSaveTimingState?: (state: ServiceWorkerState) => Promise<void>;
  },
): Promise<boolean> {
  if (callbacks.isCurrent?.() === false) return Promise.resolve(false);
  if (state.streamerAcquisitionInFlight && state.streamerAcquisitionDeadlineAt > Date.now()) {
    return state.streamerAcquisitionInFlight;
  }
  const generation = (state.streamerAcquisitionGeneration ?? 0) + 1;
  state.streamerAcquisitionGeneration = generation;
  const epoch = currentFarmingSessionEpoch(state);
  const tick = state.tickGeneration;
  const key = state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null;
  const deadline = Date.now() + ACQUISITION_TIMEOUT_MS;
  const owns = () => state.streamerAcquisitionGeneration === generation;
  const authorized = () =>
    callbacks.isCurrent?.() !== false &&
    currentFarmingSessionEpoch(state) === epoch &&
    state.tickGeneration === tick &&
    (state.appState.selectedGame ? gameKey(state.appState.selectedGame) : null) === key;
  const isCurrent = () => owns() && authorized() && Date.now() < deadline;
  const release = () => {
    if (!owns()) return;
    state.streamerAcquisitionInFlight = null;
    state.streamerAcquisitionDeadlineAt = 0;
  };
  state.streamerAcquisitionDeadlineAt = deadline;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      if (!owns() || !authorized()) {
        resolve(false);
        return;
      }
      state.streamerAcquisitionGeneration += 1;
      state.streamerAcquisitionInFlight = null;
      state.streamerAcquisitionDeadlineAt = 0;
      applyApiBackoff(state);
      applyGlobalStreamerRecoveryState(state, 'network');
      const save = async () => {
        await callbacks.onSaveState?.();
        if (authorized()) await callbacks.onSaveTimingState?.(state);
      };
      resolve(false);
      void save().catch((error: unknown) => {
        logWarn('Failed to persist expired streamer acquisition', { error: String(error) });
      });
    }, ACQUISITION_TIMEOUT_MS);
  });
  const pending = Promise.race([operation(isCurrent, release), timeout]).finally(() => {
    clearTimeout(timer);
    release();
  });
  state.streamerAcquisitionInFlight = pending;
  return pending;
}
