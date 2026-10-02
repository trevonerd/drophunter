import { browser } from '../shared/browser-api.ts';
import { createChromeFarmingAutomationHost } from './farming-automation-chrome-host.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import { type ManagedWatchMarker, managedWatchMarker } from './managed-watch-marker.ts';
import { listManagedWatches } from './managed-watch-registry.ts';
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
      readonly status?: string;
    } | null>;
    query(query: { readonly windowId?: number }): Promise<readonly { readonly id?: number }[]>;
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
  const proof = stored?.[key];
  const opening = typeof proof === 'object' && proof !== null && 'opening' in proof && proof.opening === true;
  const tab = sessionProof
    ? await attemptOwnedTabOperation(() => operations.tabs.get(ownership.tabId))
    : null;
  if (
    tab?.id === ownership.tabId &&
    typeof tab.windowId === 'number' &&
    (tab.url === expectedUrl ||
      (includePending &&
        tab.url === 'about:blank' &&
        (tab.pendingUrl === expectedUrl || (opening && !tab.pendingUrl))))
  )
    return ownership;
  const marked = await operations.managedWatchMarker
    ?.locate(ownership.ownershipToken, expectedUrl)
    .catch(() => null);
  return typeof marked?.id === 'number' && marked.url === expectedUrl && typeof marked.windowId === 'number'
    ? { ...ownership, tabId: marked.id }
    : null;
}

export type ReusedManagedTab = {
  readonly id: number;
  readonly restorePrevious: () => Promise<void>;
};

const managedNavigationVersions = new Map<number, symbol>();

export async function retireManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
): Promise<void> {
  await attemptOwnedTabOperation(async () => {
    await operations.sessionStorage.remove(managedTabOwnershipKey(ownership.ownershipToken));
    return true;
  });
  await attemptOwnedTabOperation(async () => {
    await operations.managedWatchMarker?.forget?.(ownership.ownershipToken);
    return true;
  });
}

export async function reuseManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  expectedUrl: string,
  operations: ManagedTabOwnershipOperations,
  waitForComplete: (tabId: number, timeoutMs: number) => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<ReusedManagedTab | null> {
  const recovered = await recoverManagedTabOwnership(ownership, operations, true);
  if (!recovered || !isCurrent()) return null;
  const previousUrl = streamerWatchUrl(ownership.expectedChannel);
  const version = Symbol();
  managedNavigationVersions.set(recovered.tabId, version);
  const tab = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
  if (!tab || !isCurrent()) return null;
  const needsNavigation = tab.url !== expectedUrl && tab.pendingUrl !== expectedUrl;
  if (needsNavigation) {
    const navigated = await attemptOwnedTabOperation(async () => {
      await operations.tabs.update(recovered.tabId, { url: expectedUrl, active: false, muted: true });
      return true;
    });
    if (!navigated) return null;
  }

  const restorePrevious = async (): Promise<void> => {
    if (managedNavigationVersions.get(recovered.tabId) !== version) return;
    const current = await attemptOwnedTabOperation(() => operations.tabs.get(recovered.tabId));
    if (managedNavigationVersions.get(recovered.tabId) !== version) return;
    const stillOnReplacement =
      current?.id === recovered.tabId &&
      (current.url === expectedUrl || (current.url === 'about:blank' && current.pendingUrl === expectedUrl));
    if (!stillOnReplacement) return;
    if (needsNavigation && current?.url !== previousUrl) {
      const restored = await attemptOwnedTabOperation(async () => {
        await operations.tabs.update(recovered.tabId, {
          url: previousUrl,
          active: false,
          muted: true,
        });
        return true;
      });
      if (!restored) return;
      await waitForComplete(recovered.tabId, 15_000).catch(() => undefined);
    }
    if (managedNavigationVersions.get(recovered.tabId) !== version) return;
    await operations.managedWatchMarker
      ?.write(recovered.tabId, ownership.ownershipToken, previousUrl)
      .catch(() => false);
  };

  if (!isCurrent()) {
    await restorePrevious();
    return null;
  }
  return { id: recovered.tabId, restorePrevious };
}

export async function releaseManagedTabOwnership(
  ownership: ManagedWatchOwnership,
  operations: ManagedTabOwnershipOperations,
): Promise<WatchReleaseResult> {
  const recovered = await recoverManagedTabOwnership(ownership, operations, true);
  if (!recovered) return { kind: 'abandoned-unproven' };
  return { kind: 'not-required' };
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

export async function createManagedTab(
  url: string,
  active = false,
  allowInitialCreation = false,
): Promise<Browser.tabs.Tab | null> {
  const tab = await createChromeFarmingAutomationHost()
    .tabs.create({ url, active: false, muted: true }, undefined, allowInitialCreation)
    .catch(() => null);
  if (typeof tab?.id !== 'number') return null;
  if (tab.restorePrevious) {
    await waitForTabComplete(tab.id, 15_000);
    if (!(await managedWatchMarker.write(tab.id, globalThis.crypto.randomUUID(), url))) {
      await tab.restorePrevious();
      return null;
    }
  }
  return (await browser.tabs.update(tab.id, { active }).catch(() => null)) ?? null;
}

export async function ensureManagedTab(
  existingTabId: number | null,
  targetUrl: string,
  active = false,
  allowInitialCreation = false,
): Promise<number | null> {
  if (existingTabId !== null) {
    const tabs = await browser.tabs.query({}).catch(() => null);
    if (!tabs) return null;
    const registered = await listManagedWatches();
    if (
      tabs.some((tab) => tab.id === existingTabId) &&
      !registered.some((item) => item.tabId === existingTabId)
    )
      return null;
  }
  const created = await createManagedTab(targetUrl, active, allowInitialCreation);
  return created?.id ?? null;
}

export async function closeManagedTabIfSafe(tabId: number | null): Promise<boolean> {
  if (tabId !== null) managedNavigationVersions.delete(tabId);
  return false;
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
