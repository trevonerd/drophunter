import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import {
  managedWatchMarker,
  pauseManagedWatch,
  serializeManagedWatchMutation,
} from './managed-watch-marker.ts';
import {
  managedTabOwnershipKey,
  reuseManagedTabOwnership,
  streamerWatchUrl,
} from './managed-watch-ownership-proof.ts';
import { reconcileManagedWatchesBeforeCreate } from './managed-watch-preflight.ts';
import { rememberManagedWatch } from './managed-watch-registry.ts';
import { waitForTabComplete } from './tab-management.ts';

// All native callers share the same browser-wide acquisition queue.
let acquisitionTail: Promise<void> = Promise.resolve();
const unregisteredWatches = new WeakMap<object, Extract<WatchOwnershipV1, { kind: 'managed-tab' }>>();

export function createManagedWatchTabAcquisition(
  host: FarmingAutomationChromeHost,
  currentOwnership: () => WatchOwnershipV1 | null,
): FarmingAutomationChromeHost['tabs']['create'] {
  return (properties, isCurrent = () => true, allowInitialCreation = false) => {
    const acquisition = acquisitionTail.then(async () => {
      if (!isCurrent()) return null;
      const pending = unregisteredWatches.get(browser.tabs);
      if (pending) {
        const tabs = await browser.tabs.query({});
        if (tabs.some((tab) => tab.id === pending.tabId)) {
          const url = streamerWatchUrl(pending.expectedChannel);
          await host.sessionStorage.set({
            [managedTabOwnershipKey(pending.ownershipToken)]: {
              version: 1,
              expectedUrl: url,
              opening: true,
            },
          });
          await rememberManagedWatch(pending.tabId, pending.ownershipToken, url);
        }
        unregisteredWatches.delete(browser.tabs);
      }
      const incumbent = currentOwnership();
      const decision = await reconcileManagedWatchesBeforeCreate(host, incumbent, isCurrent);
      if (!isCurrent() || decision.kind === 'blocked') return null;
      if (decision.kind === 'reuse') {
        return reuseManagedTabOwnership(decision.ownership, properties.url, host, isCurrent);
      }
      if (decision.kind === 'create' && !allowInitialCreation && !decision.previouslyOwned) return null;
      const tab = await browser.tabs.create({ url: 'about:blank', active: properties.active });
      if (typeof tab.id !== 'number') return null;
      const token = globalThis.crypto.randomUUID();
      const ownership = {
        kind: 'managed-tab',
        tabId: tab.id,
        ownershipToken: token,
        expectedChannel: new URL(properties.url).pathname.slice(1),
      } as const;
      unregisteredWatches.set(browser.tabs, ownership);
      await host.sessionStorage.set({
        [managedTabOwnershipKey(token)]: {
          version: 1,
          expectedUrl: properties.url,
          opening: true,
        },
      });
      await rememberManagedWatch(tab.id, token, properties.url);
      unregisteredWatches.delete(browser.tabs);
      if (!isCurrent()) return null;
      const configured = await serializeManagedWatchMutation(() =>
        isCurrent()
          ? browser.tabs.update(tab.id, { url: properties.url, muted: properties.muted })
          : Promise.resolve(null),
      );
      if (!configured) return null;
      const pauseCancelledCreation = async () => {
        await waitForTabComplete(ownership.tabId, 15_000);
        if (await managedWatchMarker.write(ownership.tabId, token, properties.url))
          await pauseManagedWatch(ownership);
        return null;
      };
      if (!isCurrent()) return pauseCancelledCreation();
      await host.sessionStorage.set({
        [managedTabOwnershipKey(token)]: {
          version: 1,
          expectedUrl: properties.url,
        },
      });
      await managedWatchMarker.write(tab.id, token, properties.url, isCurrent);
      if (!isCurrent()) return pauseCancelledCreation();
      return configured ?? { ...tab, url: properties.url };
    });
    acquisitionTail = acquisition.then(
      () => undefined,
      () => undefined,
    );
    return acquisition;
  };
}
