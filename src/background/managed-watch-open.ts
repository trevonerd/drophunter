import type { PlaybackPrepResult } from '../types/index.ts';
import { STREAM_VALIDATION_GRACE_MS } from './constants.ts';
import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import { currentFarmingSessionEpoch } from './farming-session-revision.ts';
import { managedWatchMarker } from './managed-watch-marker.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import {
  managedTabOwnershipKey,
  releaseManagedTabOwnership,
  streamerWatchUrl,
  waitForTabComplete,
} from './tab-management.ts';
import type { FarmingTarget, ManagedTabOpenResult } from './watch-transport.ts';

export async function openOwnedManagedWatch(
  state: ServiceWorkerState,
  target: FarmingTarget,
  preparePlayback: (tabId: number, isCurrent: () => boolean) => Promise<PlaybackPrepResult>,
): Promise<ManagedTabOpenResult> {
  const epoch = currentFarmingSessionEpoch(state);
  const isCurrent = () => currentFarmingSessionEpoch(state) === epoch;
  const host = createChromeFarmingAutomationHost();
  const ownershipToken = globalThis.crypto.randomUUID();
  const expectedUrl = streamerWatchUrl(target.channelName);
  const ownershipKey = managedTabOwnershipKey(ownershipToken);
  let retained = false;
  try {
    await host.sessionStorage.set({ [ownershipKey]: { version: 1, expectedUrl } });
    if (!isCurrent()) return null;
    const tab = await host.tabs.create({ url: expectedUrl, active: false, muted: true }, isCurrent);
    if (typeof tab?.id !== 'number') return null;
    const ownership = {
      kind: 'managed-tab' as const,
      tabId: tab.id,
      ownershipToken,
      expectedChannel: target.channelName,
    };
    let accepted = false;
    try {
      if (isCurrent()) await waitForTabComplete(tab.id, 15_000);
      if (isCurrent() && (await managedWatchMarker.write(tab.id, ownershipToken, expectedUrl))) {
        if (isCurrent()) {
          await preparePlayback(tab.id, isCurrent);
          accepted = isCurrent();
        }
      }
    } finally {
      if (!accepted) await releaseManagedTabOwnership(ownership, host);
    }
    if (!accepted) return null;
    state.appState.tabId = tab.id;
    state.appState.activeStreamer = {
      id: target.channelName,
      name: target.channelName,
      displayName: target.channelName,
      isLive: true,
    };
    state.invalidStreamChecks = 0;
    state.streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
    retained = true;
    return { owner: 'drophunter', tabId: tab.id, ownership };
  } catch {
    return null;
  } finally {
    if (!retained) await host.sessionStorage.remove(ownershipKey).catch(() => undefined);
  }
}
