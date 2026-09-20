import { browser } from '../shared/browser-api.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import type { ManagedWatchMarker } from './managed-watch-marker.ts';
import { shouldCloseManagedTab } from './runtime-state.ts';
import type { ServiceWorkerState } from './service-worker.ts';
import type { WatchReleaseResult } from './watch-transport-transition.ts';

const FARMING_AUTOMATION_OWNERSHIP_KEY_PREFIX = 'farmingAutomationOwnedWatch:';

type ManagedWatchOwnership = Extract<WatchOwnershipV1, { readonly kind: 'managed-tab' }>;

export interface ManagedTabOwnershipOperations {
  readonly managedWatchMarker?: ManagedWatchMarker;
  readonly tabs: {
    get(tabId: number): Promise<{
      readonly id?: number;
      readonly windowId?: number;
      readonly url?: string;
      readonly pendingUrl?: string;
    } | null>;
    query(query: { readonly windowId: number }): Promise<readonly { readonly id?: number }[]>;
    update(
      tabId: number,
      properties: { readonly url: string; readonly active: false; readonly muted: true },
    ): Promise<void>;
    remove(tabId: number): Promise<void>;
  };
  readonly sessionStorage: {
    get(key: string): Promise<Readonly<Record<string, unknown>>>;
    remove(key: string): Promise<void>;
  };
}

export function managedTabOwnershipKey(token: string): string {
  return `${FARMING_AUTOMATION_OWNERSHIP_KEY_PREFIX}${token}`;
}

function isStoredOwnershipProof(value: unknown, expectedUrl: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'expectedUrl' in value &&
    value.expectedUrl === expectedUrl
  );
}

async function attemptOwnedTabOperation<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export async function recoverManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
  includePending = false,
): Promise<ManagedWatchOwnership | null> {
  const key = managedTabOwnershipKey(ownership.ownershipToken);
  const stored = await attemptOwnedTabOperation(() => operations.sessionStorage.get(key));
  const expectedUrl = streamerWatchUrl(ownership.expectedChannel);
  const sessionProof = stored && isStoredOwnershipProof(stored[key], expectedUrl);
  const tab = sessionProof
    ? await attemptOwnedTabOperation(() => operations.tabs.get(ownership.tabId))
    : null;
  if (
    tab?.id === ownership.tabId &&
    typeof tab.windowId === 'number' &&
    (tab.url === expectedUrl ||
      (includePending && tab.url === 'about:blank' && tab.pendingUrl === expectedUrl))
  )
    return ownership;
  const marked = await operations.managedWatchMarker
    ?.locate(ownership.ownershipToken, expectedUrl)
    .catch(() => null);
  return typeof marked?.id === 'number' && marked.url === expectedUrl && typeof marked.windowId === 'number'
    ? { ...ownership, tabId: marked.id }
    : null;
}

export async function releaseManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
): Promise<WatchReleaseResult> {
  const recovered = await recoverManagedTabOwnership(ownership, operations, true);
  if (!recovered) return { kind: 'abandoned-unproven' };
  const key = managedTabOwnershipKey(ownership.ownershipToken);
  const expectedUrl = streamerWatchUrl(ownership.expectedChannel);
  const tab = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
  const matchesUrl = (value: { readonly url?: string; readonly pendingUrl?: string }) =>
    value.url === expectedUrl || (value.url === 'about:blank' && value.pendingUrl === expectedUrl);
  if (tab?.id !== recovered.tabId || !matchesUrl(tab) || typeof tab.windowId !== 'number')
    return { kind: 'abandoned-unproven' };
  const tabId = tab.id;
  const windowId = tab.windowId;
  const windowTabs = await attemptOwnedTabOperation(() => operations.tabs.query({ windowId }));
  if (!windowTabs) return { kind: 'abandoned-unproven' };
  const currentTab = await attemptOwnedTabOperation(() => operations.tabs.get(tabId));
  if (currentTab?.id !== tabId || !matchesUrl(currentTab) || currentTab.windowId !== windowId)
    return { kind: 'abandoned-unproven' };
  const method = windowTabs.length > 1 ? 'closed' : 'neutralized';
  const released = await attemptOwnedTabOperation(async () => {
    if (method === 'closed') await operations.tabs.remove(tabId);
    else await operations.tabs.update(tabId, { url: 'about:blank', active: false, muted: true });
    return true;
  });
  if (!released) return { kind: 'abandoned-unproven' };
  await attemptOwnedTabOperation(async () => {
    await operations.sessionStorage.remove(key);
    await operations.managedWatchMarker?.forget?.(ownership.ownershipToken);
    return true;
  });
  return { kind: 'released', method };
}

export function streamerWatchUrl(channelName: string): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  return `https://www.twitch.tv/${channel}`;
}

export function monitorDashboardUrl(): string {
  return browser.runtime.getURL('/monitor.html');
}

export async function applyBestEffortAlwaysOnTop(windowId: number) {
  const opts = { focused: true, alwaysOnTop: true };
  await browser.windows
    .update(windowId, opts)
    .catch(() => browser.windows.update(windowId, { focused: true }).catch(() => undefined));
}

export async function createManagedTab(url: string, active = false): Promise<Browser.tabs.Tab | null> {
  if (active) {
    const currentActiveTab =
      (await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0] ?? null;
    if (currentActiveTab?.id) {
      const currentUrl = currentActiveTab.url;
      const canReuseCurrent =
        typeof currentUrl === 'string' &&
        (currentUrl === 'about:blank' ||
          currentUrl.startsWith('chrome://newtab') ||
          currentUrl.startsWith('edge://newtab') ||
          /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(currentUrl));
      if (canReuseCurrent) {
        const updated = await browser.tabs
          .update(currentActiveTab.id, { url, active: true })
          .catch(() => null);
        if (updated?.id) {
          return updated;
        }
      }
    }
  }

  const focusedWindow = await browser.windows.getLastFocused().catch(() => null);
  if (focusedWindow?.id) {
    return browser.tabs.create({ windowId: focusedWindow.id, url, active }).catch(() => null);
  }

  return browser.tabs.create({ url, active }).catch(() => null);
}

export async function ensureManagedTab(
  existingTabId: number | null,
  targetUrl: string,
  active = false,
): Promise<number | null> {
  if (existingTabId) {
    const existingTab = await browser.tabs.get(existingTabId).catch(() => null);
    if (existingTab?.id) {
      const existingUrl = existingTab.url ?? '';
      const isOnTwitch = /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(existingUrl);
      if (isOnTwitch) {
        if (existingTab.url !== targetUrl) {
          await browser.tabs.update(existingTab.id, { url: targetUrl, active }).catch(() => undefined);
        } else if (active && !existingTab.active) {
          await browser.tabs.update(existingTab.id, { active: true }).catch(() => undefined);
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

  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.id || typeof tab.windowId !== 'number') {
    return false;
  }

  const windowTabs = await browser.tabs.query({ windowId: tab.windowId }).catch(() => []);
  if (!shouldCloseManagedTab(windowTabs.length)) {
    return false;
  }

  await browser.tabs.remove(tab.id).catch(() => undefined);
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
