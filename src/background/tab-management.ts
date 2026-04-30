import { shouldCloseManagedTab } from './runtime-state.ts';

import type { ServiceWorkerState } from './service-worker.ts';

export function streamerWatchUrl(channelName: string): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  return `https://www.twitch.tv/${channel}`;
}

export function monitorDashboardUrl(): string {
  return chrome.runtime.getURL('monitor.html');
}

export async function applyBestEffortAlwaysOnTop(windowId: number) {
  const opts = { focused: true, alwaysOnTop: true };
  await chrome.windows
    .update(windowId, opts as unknown as chrome.windows.UpdateInfo)
    .catch(() => chrome.windows.update(windowId, { focused: true }).catch(() => undefined));
}

export async function createManagedTab(url: string, active = false): Promise<chrome.tabs.Tab | null> {
  if (active) {
    const currentActiveTab =
      (await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0] ?? null;
    if (currentActiveTab?.id) {
      const currentUrl = currentActiveTab.url ?? '';
      const canReuseCurrent =
        !currentUrl ||
        currentUrl === 'about:blank' ||
        currentUrl.startsWith('chrome://newtab') ||
        currentUrl.startsWith('edge://newtab') ||
        /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(currentUrl);
      if (canReuseCurrent) {
        const updated = await chrome.tabs
          .update(currentActiveTab.id, { url, active: true })
          .catch(() => null);
        if (updated?.id) {
          return updated;
        }
      }
    }
  }

  const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
  if (focusedWindow?.id) {
    return chrome.tabs.create({ windowId: focusedWindow.id, url, active }).catch(() => null);
  }

  return chrome.tabs.create({ url, active }).catch(() => null);
}

export async function ensureManagedTab(
  existingTabId: number | null,
  targetUrl: string,
  active = false,
): Promise<number | null> {
  if (existingTabId) {
    const existingTab = await chrome.tabs.get(existingTabId).catch(() => null);
    if (existingTab?.id) {
      const existingUrl = existingTab.url ?? '';
      const isOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(existingUrl);
      if (isOnTwitch) {
        if (existingTab.url !== targetUrl) {
          await chrome.tabs.update(existingTab.id, { url: targetUrl, active }).catch(() => undefined);
        } else if (active && !existingTab.active) {
          await chrome.tabs.update(existingTab.id, { active: true }).catch(() => undefined);
        }
        return existingTab.id;
      }
    }
  }

  const created = await createManagedTab(targetUrl, active);
  return created?.id ?? null;
}

export async function closeManagedTabIfSafe(tabId: number | null): Promise<boolean> {
  if (!tabId) {
    return false;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id || typeof tab.windowId !== 'number') {
    return false;
  }

  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId }).catch(() => []);
  if (!shouldCloseManagedTab(windowTabs.length)) {
    return false;
  }

  await chrome.tabs.remove(tab.id).catch(() => undefined);
  return true;
}

export function clearManagedTabOwnership(state: ServiceWorkerState) {
  state.appState.tabId = null;
  state.appState.activeStreamer = null;
}

export async function waitForTabComplete(tabId: number, timeoutMs = 12_000): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };

    const onUpdated = (updatedTabId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') {
          finish();
        }
      })
      .catch(() => finish());
  });
}

export function shouldMuteManagedFarmingTab(state: ServiceWorkerState): boolean {
  return state.appState.muteFarmingTab !== false;
}

export async function syncManagedTabMuteState(state: ServiceWorkerState) {
  if (!state.appState.tabId) {
    return;
  }
  await chrome.tabs
    .update(state.appState.tabId, { muted: shouldMuteManagedFarmingTab(state) })
    .catch(() => undefined);
}
