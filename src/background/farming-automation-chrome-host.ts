import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { managedWatchMarker } from './managed-watch-marker.ts';
import { resolveManagedWatchTabIds } from './managed-watch-observation.ts';
import { reconcileManagedWatchesBeforeCreate } from './managed-watch-preflight.ts';
import { rememberManagedWatch } from './managed-watch-registry.ts';
import {
  managedTabOwnershipKey,
  releaseManagedTabOwnership,
  reuseManagedTabOwnership,
  streamerWatchUrl,
  waitForTabComplete,
} from './tab-management.ts';

// ponytail: one browser-wide acquisition queue; split only for independent farming tabs.
let acquisitionTail: Promise<void> = Promise.resolve();
const unregisteredWatches = new WeakMap<object, Extract<WatchOwnershipV1, { kind: 'managed-tab' }>>();

export function createChromeFarmingAutomationHost(
  currentOwnership: () => WatchOwnershipV1 | null = () => null,
): FarmingAutomationChromeHost {
  const host: FarmingAutomationChromeHost = {
    managedWatchMarker,
    resolveManagedTabIds: () => resolveManagedWatchTabIds(host),
    tabs: {
      create: (
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
      },
      get: (tabId) => browser.tabs.get(tabId),
      query: (query) => browser.tabs.query(query),
      update: async (tabId, properties) => void (await browser.tabs.update(tabId, properties)),
      remove: async (tabId) => void (await browser.tabs.remove(tabId)),
    },
    sessionStorage: {
      get: (key) => browser.storage.session.get(key),
      set: async (values) => void (await browser.storage.session.set(values)),
      remove: async (key) => void (await browser.storage.session.remove(key)),
    },
    permissions: { hasNotifications: () => browser.permissions.contains({ permissions: ['notifications'] }) },
    notifications: { create: (id, notification) => browser.notifications.create(id, notification) },
    alarms: {
      clear: (name) => browser.alarms.clear(name),
      create: async (name, info) => void (await browser.alarms.create(name, info)),
    },
    runtime: { getUrl: (path) => new URL(path, browser.runtime.getURL('/popup.html')).toString() },
  };
  return host;
}
