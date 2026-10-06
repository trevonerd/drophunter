import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { managedWatchMarker } from './managed-watch-marker.ts';
import {
  managedTabOwnershipKey,
  releaseManagedTabOwnership,
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
  return (
    properties,
    isCurrent = () => true,
    allowInitialCreation = false,
    preserveExistingWatch = false,
  ) => {
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
      const provisionalProof =
        preserveExistingWatch && incumbent?.kind === 'managed-tab'
          ? { provisional: true as const, replacesOwnershipToken: incumbent.ownershipToken }
          : {};
      const decision = await reconcileManagedWatchesBeforeCreate(host, incumbent, isCurrent);
      if (!isCurrent() || decision.kind === 'blocked') return null;
      if (decision.kind === 'reuse' && !preserveExistingWatch) {
        return reuseManagedTabOwnership(
          decision.ownership,
          properties.url,
          host,
          waitForTabComplete,
          isCurrent,
        );
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
      let handedOff = false;
      try {
        await host.sessionStorage.set({
          [managedTabOwnershipKey(token)]: {
            version: 1,
            expectedUrl: properties.url,
            opening: true,
            ...provisionalProof,
          },
        });
        await rememberManagedWatch(tab.id, token, properties.url, provisionalProof);
        unregisteredWatches.delete(browser.tabs);
        if (!isCurrent()) return null;
        const configured = await browser.tabs.update(tab.id, {
          url: properties.url,
          muted: properties.muted,
        });
        if (!isCurrent()) return null;
        await host.sessionStorage.set({
          [managedTabOwnershipKey(token)]: {
            version: 1,
            expectedUrl: properties.url,
            ...provisionalProof,
          },
        });
        await managedWatchMarker.write(tab.id, token, properties.url);
        if (preserveExistingWatch)
          await rememberManagedWatch(tab.id, token, properties.url, provisionalProof);
        if (!isCurrent()) return null;
        handedOff = true;
        return configured ?? { ...tab, url: properties.url };
      } finally {
        if (preserveExistingWatch && !handedOff) {
          const released = await releaseManagedTabOwnership(ownership, host, { discard: true }).catch(
            () => null,
          );
          if (released?.kind === 'released') unregisteredWatches.delete(browser.tabs);
        }
      }
    });
    acquisitionTail = acquisition.then(
      () => undefined,
      () => undefined,
    );
    return acquisition;
  };
}
