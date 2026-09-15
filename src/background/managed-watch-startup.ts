import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { listManagedWatches, rememberManagedWatch } from './managed-watch-registry.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  recoverManagedTabOwnership,
  releaseManagedTabOwnership,
  streamerWatchUrl,
} from './tab-management.ts';

export async function reconcileManagedWatchesOnStartup(
  state: ServiceWorkerState,
  receiptOwnership: WatchOwnershipV1 | null,
): Promise<WatchOwnershipV1 | null> {
  const epoch = currentFarmingSessionEpoch(state);
  const host = createChromeFarmingAutomationHost();
  const registered = await listManagedWatches();
  const handles = new Map(registered.map((ownership) => [ownership.ownershipToken, ownership]));
  if (receiptOwnership?.kind === 'managed-tab')
    handles.set(receiptOwnership.ownershipToken, receiptOwnership);
  const recovered = [];
  for (const ownership of handles.values()) {
    const current = await recoverManagedTabOwnership(ownership, host);
    if (current) recovered.push(current);
  }
  const resumable =
    state.appState.isRunning && !state.appState.isPaused && currentFarmingSessionEpoch(state) === epoch;
  const matching = recovered.filter(
    (ownership) =>
      resumable &&
      ownership.expectedChannel.toLowerCase() === state.appState.activeStreamer?.name.toLowerCase(),
  );
  const selected = matching.length === 1 ? (matching[0] ?? null) : null;
  for (const ownership of recovered) {
    if (ownership === selected) continue;
    await releaseManagedTabOwnership(ownership, host);
  }
  if (selected && currentFarmingSessionEpoch(state) === epoch) {
    await rememberManagedWatch(
      selected.tabId,
      selected.ownershipToken,
      streamerWatchUrl(selected.expectedChannel),
    );
    if (
      currentFarmingSessionEpoch(state) === epoch &&
      state.appState.isRunning &&
      !state.appState.isPaused &&
      selected.expectedChannel.toLowerCase() === state.appState.activeStreamer?.name.toLowerCase()
    ) {
      state.appState.tabId = selected.tabId;
      return selected;
    }
  }
  if (selected) await releaseManagedTabOwnership(selected, host);
  if (currentFarmingSessionEpoch(state) === epoch) state.appState.tabId = null;
  return receiptOwnership?.kind === 'tabless' ? receiptOwnership : null;
}
