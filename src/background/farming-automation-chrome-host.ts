import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { managedWatchMarker, serializeManagedWatchMutation } from './managed-watch-marker.ts';
import { updateManagedWatchTab } from './managed-watch-navigation.ts';
import { createManagedWatchOwnership, type ManagedWatchOwnership } from './managed-watch-ownership.ts';
import { createManagedWatchTabAcquisition } from './managed-watch-ownership-acquisition.ts';
import { waitForTabComplete } from './tab-management.ts';

export function createChromeFarmingAutomationHost(
  currentOwnership: () => WatchOwnershipV1 | null = () => null,
): FarmingAutomationChromeHost & { readonly managedWatchOwnership: ManagedWatchOwnership } {
  let acquireTab: FarmingAutomationChromeHost['tabs']['create'];
  let ownership: ReturnType<typeof createManagedWatchOwnership>;
  const host: FarmingAutomationChromeHost = {
    managedWatchMarker,
    resolveManagedTabIds: () => ownership.observeTabIds(),
    tabs: {
      create: (...args) => acquireTab(...args),
      get: (tabId) => browser.tabs.get(tabId),
      query: (query) => browser.tabs.query(query),
      update: async (tabId, properties, isCurrent = () => true) =>
        void (await serializeManagedWatchMutation(async () =>
          updateManagedWatchTab(tabId, properties, isCurrent),
        )),
      remove: async (tabId, isCurrent = () => true) =>
        void (await serializeManagedWatchMutation(async () =>
          (await isCurrent()) ? browser.tabs.remove(tabId) : null,
        )),
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
  acquireTab = createManagedWatchTabAcquisition(host, currentOwnership);
  ownership = createManagedWatchOwnership({
    host,
    currentOwnership,
    waitForTabComplete,
    recordDurableOwnership: true,
  });
  return { ...host, managedWatchOwnership: ownership };
}
