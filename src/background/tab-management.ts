import { browser } from '../shared/browser-api.ts';
import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import type { ServiceWorkerState } from './service-worker.ts';

export { managedTabOwnershipKey, streamerWatchUrl } from './managed-watch-ownership-proof.ts';

export function monitorDashboardUrl(): string {
  return browser.runtime.getURL('/monitor.html');
}

export async function applyBestEffortAlwaysOnTop(windowId: number) {
  const opts = { focused: true, alwaysOnTop: true };
  try {
    await browser.windows.update(windowId, opts);
  } catch {
    await browser.windows.update(windowId, { focused: true }).catch(() => undefined);
  }
}

export async function createManagedTab(
  url: string,
  active = false,
  allowInitialCreation = false,
): Promise<Browser.tabs.Tab | null> {
  return openSelectionTab(null, url, active, allowInitialCreation);
}

async function openSelectionTab(
  existingTabId: number | null,
  targetUrl: string,
  active: boolean,
  allowInitialCreation: boolean,
  isCurrent: () => boolean = () => true,
): Promise<Browser.tabs.Tab | null> {
  if (!isCurrent()) return null;
  const candidate = await createChromeFarmingAutomationHost()
    .managedWatchOwnership.acquire(new URL(targetUrl).pathname.slice(1), {
      purpose: 'selection',
      knownTabId: existingTabId,
      allowInitialCreation,
      isCurrent,
      retainOnFailure: true,
    })
    .catch(() => null);
  if (!candidate) return null;
  if (!isCurrent()) {
    await candidate.discard();
    return null;
  }
  const tab = await browser.tabs.update(candidate.ownership.tabId, { active }).catch(() => null);
  if (!tab || !isCurrent()) {
    await candidate.discard();
    return null;
  }
  return tab;
}

export async function ensureManagedTab(
  existingTabId: number | null,
  targetUrl: string,
  active = false,
  allowInitialCreation = false,
  isCurrent: () => boolean = () => true,
): Promise<number | null> {
  const tab = await openSelectionTab(existingTabId, targetUrl, active, allowInitialCreation, isCurrent);
  return tab?.id ?? null;
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
      browser.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };

    const onUpdated = (updatedTabId: number, info: Browser.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs
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
  await browser.tabs
    .update(state.appState.tabId, { muted: shouldMuteManagedFarmingTab(state) })
    .catch(() => undefined);
}
