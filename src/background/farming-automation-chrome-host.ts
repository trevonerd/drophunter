import { browser } from '../shared/browser-api.ts';
import type { FarmingAutomationChromeHost } from './farming-automation-browser.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { managedWatchMarker } from './managed-watch-marker.ts';
import { reconcileManagedWatchesBeforeCreate } from './managed-watch-preflight.ts';
import { closeUntouchedRecoveryTab, type RecoveryTab } from './session-recovery-lifecycle.ts';

async function discardCancelledNavigation(tab: RecoveryTab, expectedUrl: string): Promise<void> {
  await closeUntouchedRecoveryTab({ ...tab, url: expectedUrl }, browser.tabs);
  if (typeof tab.id !== 'number') return;
  const current = await browser.tabs.get(tab.id).catch(() => null);
  if (
    current?.id === tab.id &&
    (current.url === expectedUrl || (current.url === 'about:blank' && current.pendingUrl === expectedUrl)) &&
    current.windowId === tab.windowId
  ) {
    await browser.tabs.update(tab.id, { url: 'about:blank', muted: true }).catch(() => undefined);
  }
}

export function createChromeFarmingAutomationHost(
  currentOwnership: () => WatchOwnershipV1 | null = () => null,
): FarmingAutomationChromeHost {
  const host: FarmingAutomationChromeHost = {
    managedWatchMarker,
    tabs: {
      create: async (properties, isCurrent = () => true) => {
        if (!isCurrent()) return null;
        const current = currentOwnership();
        if (
          !(await reconcileManagedWatchesBeforeCreate(
            host,
            current?.kind === 'managed-tab' ? current.ownershipToken : null,
            isCurrent,
          ))
        )
          return null;
        const tab = await browser.tabs.create({ url: 'about:blank', active: properties.active });
        if (typeof tab.id !== 'number') return null;
        if (!isCurrent()) {
          await closeUntouchedRecoveryTab(tab, browser.tabs);
          return null;
        }
        try {
          const configured = await browser.tabs.update(tab.id, {
            url: properties.url,
            muted: properties.muted,
          });
          if (!isCurrent()) {
            await discardCancelledNavigation(tab, properties.url);
            return null;
          }
          return configured ?? { ...tab, url: properties.url };
        } catch (error) {
          await closeUntouchedRecoveryTab(tab, browser.tabs);
          throw error;
        }
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
