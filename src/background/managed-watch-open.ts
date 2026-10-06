import { isRewardFarmableNow } from '../shared/reward-scheduling.ts';
import type { PlaybackPrepResult } from '../types/index.ts';
import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { managedWatchMarker } from './managed-watch-marker.ts';
import { rememberManagedWatch } from './managed-watch-registry.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  managedTabOwnershipKey,
  releaseManagedTabOwnership,
  streamerWatchUrl,
  waitForTabComplete,
} from './tab-management.ts';
import { createWatchHealth } from './watch-health.ts';
import type { FarmingTarget, ManagedTabOpenResult } from './watch-transport.ts';

export async function openOwnedManagedWatch(
  state: ServiceWorkerState,
  target: FarmingTarget,
  preparePlayback: (tabId: number, isCurrent: () => boolean) => Promise<PlaybackPrepResult>,
  currentOwnership: () => WatchOwnershipV1 | null = () => null,
  externalIsCurrent: () => boolean = () => true,
): Promise<ManagedTabOpenResult> {
  const epoch = currentFarmingSessionEpoch(state);
  const isCurrent = () => externalIsCurrent() && currentFarmingSessionEpoch(state) === epoch;
  const host = createChromeFarmingAutomationHost(currentOwnership);
  const incumbent = currentOwnership();
  const preserveExistingWatch =
    incumbent?.kind === 'managed-tab' &&
    state.appState.watchHealth?.isHealthy === true &&
    state.appState.currentDrop !== null &&
    isRewardFarmableNow(state.appState.currentDrop);
  const ownershipToken = globalThis.crypto.randomUUID();
  const expectedUrl = streamerWatchUrl(target.channelName);
  const ownershipKey = managedTabOwnershipKey(ownershipToken);
  let retained = false;
  let preparingTabId: number | null = null;
  let restorePrevious: (() => Promise<void>) | undefined;
  try {
    await host.sessionStorage.set({
      [ownershipKey]: {
        version: 1,
        expectedUrl,
        ...(preserveExistingWatch
          ? { provisional: true, replacesOwnershipToken: incumbent?.ownershipToken }
          : {}),
      },
    });
    if (!isCurrent()) return null;
    const tab = await host.tabs.create(
      { url: expectedUrl, active: false, muted: true },
      isCurrent,
      state.appState.manualQueueAuthorized && state.appState.farmingSessionOrigin === 'manual',
      preserveExistingWatch,
    );
    if (typeof tab?.id !== 'number') return null;
    restorePrevious = tab.restorePrevious;
    const ownership = {
      kind: 'managed-tab' as const,
      tabId: tab.id,
      ownershipToken,
      expectedChannel: target.channelName,
    };
    preparingTabId = tab.id;
    state.preparingManagedTabIds.add(tab.id);
    let accepted = false;
    let prepared: PlaybackPrepResult = {};
    try {
      if (isCurrent()) await waitForTabComplete(tab.id, 15_000);
      if (isCurrent() && (await managedWatchMarker.write(tab.id, ownershipToken, expectedUrl))) {
        if (preserveExistingWatch && incumbent?.kind === 'managed-tab')
          await rememberManagedWatch(tab.id, ownershipToken, expectedUrl, {
            provisional: true,
            replacesOwnershipToken: incumbent.ownershipToken,
          });
        if (isCurrent()) {
          prepared = await preparePlayback(tab.id, isCurrent);
          accepted =
            isCurrent() && (prepared.isPlaybackReady === true || prepared.userInteractionRequired === true);
        }
      }
    } finally {
      if (!accepted) {
        if (restorePrevious) {
          await host.sessionStorage.remove(ownershipKey).catch(() => undefined);
          await host.managedWatchMarker?.forget?.(ownershipToken).catch(() => undefined);
          await restorePrevious();
        } else {
          await releaseManagedTabOwnership(ownership, host, { discard: preserveExistingWatch });
        }
      }
    }
    if (!accepted) return null;
    retained = true;
    return {
      owner: 'drophunter',
      tabId: tab.id,
      ownership,
      health: createWatchHealth(
        'managed-tab',
        prepared.isPlaybackReady ? 'healthy' : 'degraded',
        prepared.isPlaybackReady ? 'started' : 'user-interaction-required',
        Date.now,
      ),
      dispose: async () => {
        if (restorePrevious) {
          await host.sessionStorage.remove(ownershipKey);
          await host.managedWatchMarker?.forget?.(ownershipToken);
          await restorePrevious();
        } else {
          await releaseManagedTabOwnership(ownership, host, { discard: preserveExistingWatch });
        }
      },
    };
  } catch {
    return null;
  } finally {
    if (preparingTabId !== null) state.preparingManagedTabIds.delete(preparingTabId);
    if (!retained && (preparingTabId === null || restorePrevious)) {
      await host.sessionStorage.remove(ownershipKey).catch(() => undefined);
      await host.managedWatchMarker?.forget?.(ownershipToken).catch(() => undefined);
    }
  }
}
