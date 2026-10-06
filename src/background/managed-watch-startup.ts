import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export async function reconcileManagedWatchesOnStartup(
  state: ServiceWorkerState,
  receiptOwnership: WatchOwnershipV1 | null,
): Promise<WatchOwnershipV1 | null> {
  const epoch = currentFarmingSessionEpoch(state);
  const isCurrent = () => currentFarmingSessionEpoch(state) === epoch;
  const ownership = await createChromeFarmingAutomationHost().managedWatchOwnership.reconstruct(
    receiptOwnership,
    () => ({
      running: state.appState.isRunning,
      activeChannel: state.appState.activeStreamer?.name ?? null,
      tabId: state.appState.tabId,
    }),
    isCurrent,
  );
  if (isCurrent()) {
    if (ownership?.kind === 'managed-tab') {
      if (state.appState.isRunning && !state.appState.isPaused) state.appState.tabId = ownership.tabId;
    } else state.appState.tabId = null;
  }
  return ownership;
}
