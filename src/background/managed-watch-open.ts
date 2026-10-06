import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { PlaybackPrepResult } from '../types/index.ts';
import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import type { ManagedWatchOwnership } from './managed-watch-ownership.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { createWatchHealth } from './watch-health.ts';
import type { FarmingTarget, ManagedTabOpenResult } from './watch-transport.ts';

export async function openOwnedManagedWatch(
  state: ServiceWorkerState,
  target: FarmingTarget,
  preparePlayback: (tabId: number, isCurrent: () => boolean) => Promise<PlaybackPrepResult>,
  currentOwnership: () => WatchOwnershipV1 | null = () => null,
  externalIsCurrent: () => boolean = () => true,
  ownedTabs: ManagedWatchOwnership = createChromeFarmingAutomationHost(
    currentOwnership,
  ).managedWatchOwnership,
): Promise<ManagedTabOpenResult> {
  const epoch = currentFarmingSessionEpoch(state);
  const isCurrent = () => externalIsCurrent() && currentFarmingSessionEpoch(state) === epoch;
  const preserveExistingWatch =
    currentOwnership()?.kind === 'managed-tab' &&
    state.appState.watchHealth?.isHealthy === true &&
    state.appState.currentDrop !== null &&
    isRewardFarmableNow(state.appState.currentDrop);
  const candidate = await ownedTabs
    .acquire(target.channelName, {
      isCurrent,
      preserveExistingWatch,
      retainOnFailure: true,
      allowInitialCreation:
        state.appState.manualQueueAuthorized && state.appState.farmingSessionOrigin === 'manual',
    })
    .catch(() => null);
  if (!candidate) return null;
  const tabId = candidate.ownership.tabId;
  state.preparingManagedTabIds.add(tabId);
  let accepted = false;
  try {
    if (!(await candidate.confirm())) return null;
    const prepared = await preparePlayback(tabId, isCurrent);
    accepted =
      isCurrent() && (prepared.isPlaybackReady === true || prepared.userInteractionRequired === true);
    if (!accepted) return null;
    return {
      owner: 'drophunter',
      tabId,
      ownership: candidate.ownership,
      health: createWatchHealth(
        'managed-tab',
        prepared.isPlaybackReady ? 'healthy' : 'degraded',
        prepared.isPlaybackReady ? 'started' : 'user-interaction-required',
        Date.now,
      ),
      dispose: candidate.discard,
    };
  } catch {
    return null;
  } finally {
    state.preparingManagedTabIds.delete(tabId);
    if (!accepted) await candidate.discard().catch(() => undefined);
  }
}
